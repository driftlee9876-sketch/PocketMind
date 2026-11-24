package link

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"path/filepath"
	"pocketmind/wifi/relay"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const protocol = "pocketmind-gpu/1"

var denied = errors.New("GPU 연결이 거절됐어요. 두 기기의 연결 기록과 승인 상태를 확인하세요.")

const maxPeers = 20
const meshPort = 47832

var _, meshSubnet, _ = net.ParseCIDR("100.64.0.0/10")

type Endpoint struct {
	Group  string
	Relay  string
	Mesh   bool
	Local  string
	Prefix int
	IP     string
	Port   int
	ID     string
}

func (p Endpoint) network() (*net.IPNet, error) {
	ip := net.ParseIP(p.Local).To4()
	if p.Mesh {
		if !meshSubnet.Contains(ip) {
			return nil, errors.New("Tailscale 연결을 확인하세요.")
		}
		return meshSubnet, nil
	}
	if ip == nil || !(ip.IsPrivate() || ip.IsLinkLocalUnicast()) || p.Prefix < 1 || p.Prefix > 30 {
		return nil, errors.New("같은 Wi-Fi의 IPv4 주소를 확인하세요.")
	}
	return &net.IPNet{IP: ip.Mask(net.CIDRMask(p.Prefix, 32)), Mask: net.CIDRMask(p.Prefix, 32)}, nil
}
func (p Endpoint) validate() error {
	if p.Relay != "" {
		if !relay.ValidKey(p.Relay) || !relay.ValidKey(p.ID) {
			return denied
		}
		return nil
	}
	subnet, err := p.network()
	if err != nil {
		return err
	}
	ip := net.ParseIP(p.IP).To4()
	decoded, err := base64.RawURLEncoding.DecodeString(p.ID)
	broadcast := append(net.IP(nil), subnet.IP...)
	for i := range broadcast {
		broadcast[i] |= ^subnet.Mask[i]
	}
	if (p.Mesh && p.Port != meshPort) || !subnet.Contains(ip) || ip.Equal(subnet.IP) || ip.Equal(broadcast) || ip.Equal(net.ParseIP(p.Local)) || p.Port < 1 || p.Port > 65535 || err != nil || len(decoded) != 32 {
		return errors.New("같은 Wi-Fi에서 기기를 다시 찾아 주세요.")
	}
	return nil
}

type challenge struct {
	ID        string `json:"id"`
	Peer      string `json:"peer"`
	Code      string `json:"code"`
	expected  string
	submitted bool
	vote      chan bool
}
type Engine struct {
	group                 groupKey
	nearby                net.Listener
	attached              Backend
	wanted                int
	relayBytesTransferred atomic.Uint64
	relayURL              string
	relayCancel           context.CancelFunc
	invitation            string
	invites               map[string]string
	outboundCtx           context.Context
	cancelOutbound        context.CancelFunc
	mu                    sync.Mutex
	dir, id               string
	cert                  tls.Certificate
	trusted               map[string]bool
	pending               *challenge
	issue                 string
	listener              net.Listener
	bridges               []net.Listener
	connections           map[net.Conn]bool
	epoch                 uint64
}

func New(dir string) (*Engine, error) {
	cert, id, peers, err := identity(dir)
	if err != nil {
		return nil, err
	}
	e := &Engine{relayURL: publicRelay, dir: dir, cert: cert, id: id, trusted: peers, connections: map[net.Conn]bool{}}
	e.outboundCtx, e.cancelOutbound = context.WithCancel(context.Background())
	if err := e.loadGroup(); err != nil {
		return nil, err
	}
	return e, e.loadInvites()
}
func (e *Engine) snapshot() map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()
	peers := []string{}
	for k := range e.trusted {
		peers = append(peers, k)
	}
	internet := []map[string]any{}
	for id, room := range e.invites {
		if relay.ValidKey(id) && relay.ValidKey(room) {
			internet = append(internet, internetPeer(id, room))
		}
	}
	return map[string]any{"group": e.group.tag(), "wantGPU": e.wanted > 0 && e.attached == nil, "attached": e.attached != nil, "relayBytes": e.relayBytesTransferred.Load(), "internetPeers": internet, "relayInvitation": e.invitation, "internetOffering": e.relayCancel != nil, "id": e.id, "trusted": peers, "pending": e.pending, "offering": e.listener != nil || e.relayCancel != nil, "issue": e.issue}
}
func (e *Engine) setIssue(gen uint64, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if gen == e.epoch {
		e.issue = err.Error()
	}
}
func (e *Engine) generation() uint64 { e.mu.Lock(); defer e.mu.Unlock(); return e.epoch }
func (e *Engine) track(gen uint64, c net.Conn) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	limit := 32
	if len(e.bridges) > 0 {
		limit = 32 * len(e.bridges)
	}
	if e.epoch != gen || len(e.connections) >= limit {
		c.Close()
		return false
	}
	e.connections[c] = true
	return true
}
func (e *Engine) drop(c net.Conn) { c.Close(); e.mu.Lock(); delete(e.connections, c); e.mu.Unlock() }
func (e *Engine) stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.nearby != nil {
		e.nearby.Close()
		e.nearby = nil
	}
	e.attached = nil
	e.epoch++
	e.cancelOutbound()
	e.outboundCtx, e.cancelOutbound = context.WithCancel(context.Background())
	if e.relayCancel != nil {
		e.relayCancel()
		e.relayCancel = nil
	}
	e.invitation = ""
	if e.listener != nil {
		e.listener.Close()
		e.listener = nil
	}
	for _, l := range e.bridges {
		l.Close()
	}
	e.bridges = nil
	for c := range e.connections {
		if conn, ok := c.(*tls.Conn); ok {
			conn.NetConn().Close()
		} else {
			c.Close()
		}
	}
	e.connections = map[net.Conn]bool{}
	if e.pending != nil {
		select {
		case e.pending.vote <- false:
		default:
		}
		e.pending = nil
	}
	e.issue = ""
}
func (e *Engine) saveLocked(p string) error {
	peers := map[string]bool{}
	for k := range e.trusted {
		peers[k] = true
	}
	if p != "" {
		peers[p] = true
	} else {
		peers = map[string]bool{}
	}
	raw, _ := json.Marshal(peers)
	if err := atomicWrite(filepath.Join(e.dir, "peers.json"), raw); err != nil {
		return err
	}
	e.trusted = peers
	return nil
}
func (e *Engine) vote(id string, yes bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.pending == nil || e.pending.ID != id || e.pending.submitted || (yes && e.pending.expected != "") {
		return denied
	}
	select {
	case e.pending.vote <- yes:
		e.pending.submitted = true
		return nil
	default:
		return denied
	}
}
func byteIs(c net.Conn, b byte) error {
	var one [1]byte
	if _, err := io.ReadFull(c, one[:]); err != nil {
		return err
	}
	if one[0] != b {
		return denied
	}
	return nil
}
func (e *Engine) approve(gen uint64, c *tls.Conn, peer string, client bool) error {
	state := c.ConnectionState()
	key, err := state.ExportKeyingMaterial("EXPORTER-PocketMind-GPU-pair-v1", nil, 32)
	if err != nil {
		return err
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return err
	}
	ch := &challenge{ID: base64.RawURLEncoding.EncodeToString(nonce[:]), Peer: peer, vote: make(chan bool, 1)}
	{
		local, other := key[:8], key[8:16]
		if !client {
			local, other = other, local
		}
		ch.Code = fmt.Sprintf("%06d", binary.BigEndian.Uint64(local)%1000000)
		ch.expected = fmt.Sprintf("%06d", binary.BigEndian.Uint64(other)%1000000)
	}
	e.mu.Lock()
	if e.pending != nil || e.epoch != gen {
		e.mu.Unlock()
		return denied
	}
	e.pending = ch
	e.issue = ""
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		if e.pending == ch {
			e.pending = nil
		}
		e.mu.Unlock()
	}()
	c.SetDeadline(time.Now().Add(65 * time.Second))
	remote := make(chan error, 1)
	go func(result chan<- error) { result <- byteIs(c, 'Y') }(remote)
	var local <-chan bool = ch.vote
	timer := time.NewTimer(60 * time.Second)
	defer timer.Stop()
	for local != nil || remote != nil {
		select {
		case yes := <-local:
			if !yes {
				return denied
			}
			if _, err = c.Write([]byte{'Y'}); err != nil {
				return err
			}
			local = nil
		case err := <-remote:
			if err != nil {
				return err
			}
			remote = nil
		case <-timer.C:
			return errors.New("연결 승인 시간이 지났어요.")
		}
	}
	e.mu.Lock()
	if e.epoch != gen {
		e.mu.Unlock()
		return denied
	}
	e.mu.Unlock()
	secret, err := state.ExportKeyingMaterial("EXPORTER-PocketMind-group-create", nil, 32)
	if err != nil {
		return err
	}
	if err = e.join(c, gen, secret); err != nil {
		return err
	}
	e.mu.Lock()
	if e.epoch != gen {
		e.mu.Unlock()
		return denied
	}
	err = e.saveLocked(peer)
	e.mu.Unlock()
	if err != nil {
		return err
	}
	if _, err = c.Write([]byte{'K'}); err != nil {
		return err
	}
	return byteIs(c, 'K')
}
func (e *Engine) isTrusted(p string) bool { e.mu.Lock(); defer e.mu.Unlock(); return e.trusted[p] }
func (e *Engine) dial(gen uint64, p Endpoint) (*tls.Conn, error) {
	if err := p.validate(); err != nil {
		return nil, err
	}
	var raw net.Conn
	var err error
	if p.Relay != "" {
		e.mu.Lock()
		ctx, valid := e.outboundCtx, e.epoch == gen
		e.mu.Unlock()
		if !valid {
			return nil, denied
		}
		raw, err = relay.Connect(ctx, e.relayURL, p.Relay)
		if err == nil {
			raw = &meteredRelay{Conn: raw, bytes: &e.relayBytesTransferred}
		}
	} else {
		d := net.Dialer{LocalAddr: &net.TCPAddr{IP: net.ParseIP(p.Local)}, Timeout: 6 * time.Second}
		raw, err = d.Dial("tcp4", net.JoinHostPort(p.IP, strconv.Itoa(p.Port)))
	}
	if err != nil {
		return nil, err
	}
	// Custom verification pins the discovered public key. First use also needs
	// independent approval of the TLS exporter on both device screens.
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{e.cert}, NextProtos: []string{protocol}, InsecureSkipVerify: true,
		VerifyConnection: func(cs tls.ConnectionState) error {
			if cs.NegotiatedProtocol != protocol || len(cs.PeerCertificates) != 1 || pin(cs.PeerCertificates[0]) != p.ID {
				return denied
			}
			return nil
		}}
	c := tls.Client(raw, cfg)
	if !e.track(gen, c) {
		return nil, denied
	}
	c.SetDeadline(time.Now().Add(8 * time.Second))
	if err = c.Handshake(); err != nil {
		e.drop(c)
		return nil, err
	}
	return c, nil
}
func (e *Engine) pair(p Endpoint) error {
	if err := p.validate(); err != nil {
		return err
	}
	gen := e.generation()
	go func() {
		c, err := e.dial(gen, p)
		if err == nil {
			defer e.drop(c)
			_, err = c.Write([]byte{'O'})
			if err == nil {
				err = e.approve(gen, c, p.ID, true)
			}
		}
		if err != nil {
			e.setIssue(gen, err)
		}
	}()
	return nil
}
func relayBytes(a, b net.Conn) {
	done := make(chan struct{})
	go func() { io.Copy(a, b); a.Close(); b.Close(); close(done) }()
	io.Copy(b, a)
	a.Close()
	b.Close()
	<-done
}

type Backend func() (net.Conn, error)

func (e *Engine) offer(p Endpoint, backend Backend) (int, error) {
	subnet, err := p.network()
	if err != nil {
		return 0, err
	}
	port := "0"
	if p.Mesh {
		port = strconv.Itoa(meshPort)
	}
	l, err := net.Listen("tcp4", net.JoinHostPort(p.Local, port))
	if err != nil {
		return 0, err
	}
	e.mu.Lock()
	if e.listener != nil || e.relayCancel != nil || len(e.bridges) != 0 {
		e.mu.Unlock()
		l.Close()
		return 0, errors.New("GPU 연결이 이미 실행 중이에요.")
	}
	e.attached = backend
	e.listener = l
	gen := e.epoch
	e.mu.Unlock()
	cfg := e.serverConfig()
	go func() {
		for {
			raw, err := l.Accept()
			if err != nil {
				return
			}
			if !subnet.Contains(raw.RemoteAddr().(*net.TCPAddr).IP) {
				raw.Close()
				continue
			}
			c := tls.Server(raw, cfg)
			if e.track(gen, c) {
				go e.accept(gen, c, backend)
			}
		}
	}()
	return l.Addr().(*net.TCPAddr).Port, nil
}
func (e *Engine) serverConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{e.cert}, ClientAuth: tls.RequireAnyClientCert, NextProtos: []string{protocol}}
}
func (e *Engine) accept(gen uint64, c *tls.Conn, backend Backend) {
	defer e.drop(c)
	c.SetDeadline(time.Now().Add(8 * time.Second))
	if c.Handshake() != nil {
		return
	}
	state := c.ConnectionState()
	if len(state.PeerCertificates) != 1 || state.NegotiatedProtocol != protocol {
		return
	}
	peer := pin(state.PeerCertificates[0])
	var op [1]byte
	if _, err := io.ReadFull(c, op[:]); err != nil {
		return
	}
	if op[0] == 'O' {
		if err := e.approve(gen, c, peer, false); err != nil {
			e.setIssue(gen, err)
		}
		return
	}
	if op[0] == 'G' {
		e.mu.Lock()
		key := e.group
		e.mu.Unlock()
		if groupProof(c, key, false) != nil {
			return
		}
	} else if op[0] != 'D' || !e.isTrusted(peer) {
		return
	}
	c.SetDeadline(time.Now().Add(45 * time.Second))
	b, err := backend()
	if err != nil {
		return
	}
	if !e.track(gen, b) {
		return
	}
	defer e.drop(b)
	if _, err = c.Write([]byte{'K'}); err != nil {
		return
	}
	c.SetDeadline(time.Time{})
	relayBytes(c, b)
}
func (e *Engine) connectData(gen uint64, p Endpoint) (net.Conn, error) {
	e.mu.Lock()
	key := e.group
	e.mu.Unlock()
	grouped := p.Group != "" && p.Group == key.tag()
	if !grouped && !e.isTrusted(p.ID) {
		return nil, denied
	}
	c, err := e.dial(gen, p)
	if err != nil {
		return nil, err
	}
	op := byte('D')
	if grouped {
		op = 'G'
	}
	_, err = c.Write([]byte{op})
	if err == nil && grouped {
		err = groupProof(c, key, true)
	}
	if err == nil {
		c.SetDeadline(time.Now().Add(45 * time.Second))
		err = byteIs(c, 'K')
	}
	if err != nil {
		e.drop(c)
		return nil, err
	}
	c.SetDeadline(time.Time{})
	return c, nil
}
func (e *Engine) openBridge(p Endpoint) (string, error) {
	names, err := e.openBridges([]Endpoint{p})
	if err != nil {
		return "", err
	}
	return names[0], nil
}
func (e *Engine) openBridges(peers []Endpoint) ([]string, error) {
	if len(peers) < 1 || len(peers) > maxPeers {
		return nil, errors.New("보조 기기를 1~20대 선택하세요.")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.bridges) > 0 || e.listener != nil || e.relayCancel != nil {
		return nil, denied
	}
	seen := map[string]bool{}
	for _, p := range peers {
		if err := p.validate(); err != nil {
			return nil, err
		}
		if seen[p.ID] || (!e.trusted[p.ID] && (p.Group == "" || p.Group != e.group.tag())) || p.ID == e.id {
			return nil, denied
		}
		seen[p.ID] = true
	}
	var listeners []net.Listener
	var names []string
	for range peers {
		l, name, err := localBridge()
		if err != nil {
			for _, old := range listeners {
				old.Close()
			}
			return nil, err
		}
		listeners = append(listeners, l)
		names = append(names, name)
	}
	e.bridges = listeners
	for i, p := range peers {
		e.serveBridge(listeners[i], p, e.epoch)
	}
	return names, nil
}
func (e *Engine) serveBridge(l net.Listener, p Endpoint, gen uint64) {
	go func() {
		for {
			a, err := l.Accept()
			if err != nil {
				return
			}
			if !ownUser(a) || !e.track(gen, a) {
				a.Close()
				continue
			}
			go func() {
				defer e.drop(a)
				b, err := e.connectData(gen, p)
				if err != nil {
					e.setIssue(gen, err)
					return
				}
				defer e.drop(b)
				relayBytes(a, b)
			}()
		}
	}()
}

// Commands are supplied only by the platform UI, never by network clients.
type Request struct {
	Op, Dir, Challenge, Backend, Value string
	Accept                             bool
	Endpoints                          []Endpoint
	Endpoint                           Endpoint
}

func (e *Engine) Command(q Request) (map[string]any, error) {
	switch q.Op {
	case "status":
		return e.snapshot(), nil
	case "unpresence":
		e.mu.Lock()
		if e.nearby != nil {
			e.nearby.Close()
			e.nearby = nil
		}
		e.mu.Unlock()
	case "presence":
		return e.presence(q.Endpoint)
	case "attach":
		b, err := localBackend(q.Backend, q.Value)
		if err != nil {
			return nil, err
		}
		e.mu.Lock()
		if e.wanted > 0 && e.nearby != nil && len(e.bridges) == 0 {
			e.attached = b
		}
		e.mu.Unlock()
	case "detach":
		e.mu.Lock()
		e.attached = nil
		e.mu.Unlock()
	case "enter":
		return nil, e.enter(q.Challenge, q.Value)
	case "stop":
		e.stop()
	case "forget":
		e.stop()
		e.mu.Lock()
		err := e.saveGroupLocked(groupKey{})
		if err == nil {
			err = e.saveLocked("")
		}
		if err == nil {
			err = e.saveInviteLocked("", "")
		}
		e.mu.Unlock()
		return nil, err
	case "vote":
		return nil, e.vote(q.Challenge, q.Accept)
	case "pair":
		return nil, e.pair(q.Endpoint)
	case "bridges":
		names, err := e.openBridges(q.Endpoints)
		return map[string]any{"bridges": names}, err
	case "bridge":
		name, err := e.openBridge(q.Endpoint)
		return map[string]any{"bridge": name}, err
	case "importInternet":
		return e.importInternet(q.Value)
	case "offerInternet":
		backend, err := localBackend(q.Backend, q.Value)
		if err != nil {
			return nil, err
		}
		return nil, e.offerInternet(backend)
	case "offer":
		backend, err := localBackend(q.Backend, q.Value)
		if err != nil {
			return nil, err
		}
		port, err := e.offer(q.Endpoint, backend)
		return map[string]any{"port": port, "id": e.id}, err
	default:
		return nil, errors.New("알 수 없는 GPU 작업이에요.")
	}
	return nil, nil
}
