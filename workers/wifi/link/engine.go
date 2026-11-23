package link

import (
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
	"strconv"
	"sync"
	"time"
)

const protocol = "pocketmind-gpu/1"

var denied = errors.New("GPU 연결이 거절됐어요. 두 기기의 연결 기록과 승인 상태를 확인하세요.")

type Endpoint struct {
	Local  string
	Prefix int
	IP     string
	Port   int
	ID     string
}

func (p Endpoint) network() (*net.IPNet, error) {
	ip := net.ParseIP(p.Local).To4()
	if ip == nil || !(ip.IsPrivate() || ip.IsLinkLocalUnicast()) || p.Prefix < 1 || p.Prefix > 30 {
		return nil, errors.New("같은 Wi-Fi의 IPv4 주소를 확인하세요.")
	}
	return &net.IPNet{IP: ip.Mask(net.CIDRMask(p.Prefix, 32)), Mask: net.CIDRMask(p.Prefix, 32)}, nil
}
func (p Endpoint) validate() error {
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
	if !subnet.Contains(ip) || ip.Equal(subnet.IP) || ip.Equal(broadcast) || ip.Equal(net.ParseIP(p.Local)) || p.Port < 1 || p.Port > 65535 || err != nil || len(decoded) != 32 {
		return errors.New("같은 Wi-Fi에서 기기를 다시 찾아 주세요.")
	}
	return nil
}

type challenge struct {
	ID   string `json:"id"`
	Peer string `json:"peer"`
	Code string `json:"code"`
	vote chan bool
}
type Engine struct {
	mu          sync.Mutex
	dir, id     string
	cert        tls.Certificate
	trusted     map[string]bool
	pending     *challenge
	issue       string
	listener    net.Listener
	bridge      net.Listener
	connections map[net.Conn]bool
	epoch       uint64
}

func New(dir string) (*Engine, error) {
	cert, id, peers, err := identity(dir)
	if err != nil {
		return nil, err
	}
	return &Engine{dir: dir, cert: cert, id: id, trusted: peers, connections: map[net.Conn]bool{}}, nil
}
func (e *Engine) snapshot() map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()
	peers := []string{}
	for k := range e.trusted {
		peers = append(peers, k)
	}
	return map[string]any{"id": e.id, "trusted": peers, "pending": e.pending, "offering": e.listener != nil, "issue": e.issue}
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
	if e.epoch != gen || len(e.connections) >= 32 {
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
	e.epoch++
	if e.listener != nil {
		e.listener.Close()
		e.listener = nil
	}
	if e.bridge != nil {
		e.bridge.Close()
		e.bridge = nil
	}
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
	if e.pending == nil || e.pending.ID != id {
		return denied
	}
	select {
	case e.pending.vote <- yes:
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
func (e *Engine) consent(gen uint64, c *tls.Conn, peer string) error {
	state := c.ConnectionState()
	key, err := state.ExportKeyingMaterial("EXPORTER-PocketMind-GPU-pair-v1", nil, 32)
	if err != nil {
		return err
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return err
	}
	ch := &challenge{ID: base64.RawURLEncoding.EncodeToString(nonce[:]), Peer: peer, Code: fmt.Sprintf("%08d", binary.BigEndian.Uint64(key[:8])%100000000), vote: make(chan bool, 1)}
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
	d := net.Dialer{LocalAddr: &net.TCPAddr{IP: net.ParseIP(p.Local)}, Timeout: 6 * time.Second}
	raw, err := d.Dial("tcp4", net.JoinHostPort(p.IP, strconv.Itoa(p.Port)))
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
			_, err = c.Write([]byte{'P'})
			if err == nil {
				err = e.consent(gen, c, p.ID)
			}
		}
		if err != nil {
			e.setIssue(gen, err)
		}
	}()
	return nil
}
func relay(a, b net.Conn) {
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
	l, err := net.Listen("tcp4", net.JoinHostPort(p.Local, "0"))
	if err != nil {
		return 0, err
	}
	e.mu.Lock()
	if e.listener != nil || e.bridge != nil {
		e.mu.Unlock()
		l.Close()
		return 0, errors.New("GPU 연결이 이미 실행 중이에요.")
	}
	e.listener = l
	gen := e.epoch
	e.mu.Unlock()
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{e.cert}, ClientAuth: tls.RequireAnyClientCert, NextProtos: []string{protocol}}
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
	if op[0] == 'P' {
		if err := e.consent(gen, c, peer); err != nil {
			e.setIssue(gen, err)
		}
		return
	}
	if op[0] != 'D' || !e.isTrusted(peer) {
		return
	}
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
	relay(c, b)
}
func (e *Engine) connectData(gen uint64, p Endpoint) (net.Conn, error) {
	if !e.isTrusted(p.ID) {
		return nil, denied
	}
	c, err := e.dial(gen, p)
	if err != nil {
		return nil, err
	}
	if _, err = c.Write([]byte{'D'}); err == nil {
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
	if err := p.validate(); err != nil {
		return "", err
	}
	if !e.isTrusted(p.ID) {
		return "", denied
	}
	l, name, err := localBridge()
	if err != nil {
		return "", err
	}
	e.mu.Lock()
	if e.bridge != nil || e.listener != nil {
		e.mu.Unlock()
		l.Close()
		return "", denied
	}
	e.bridge = l
	gen := e.epoch
	e.mu.Unlock()
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
				relay(a, b)
			}()
		}
	}()
	return name, nil
}

// Commands are supplied only by the platform UI, never by network clients.
type Request struct {
	Op, Dir, Challenge, Backend, Value string
	Accept                             bool
	Endpoint                           Endpoint
}

func (e *Engine) Command(q Request) (map[string]any, error) {
	switch q.Op {
	case "status":
		return e.snapshot(), nil
	case "stop":
		e.stop()
	case "forget":
		e.stop()
		e.mu.Lock()
		err := e.saveLocked("")
		e.mu.Unlock()
		return nil, err
	case "vote":
		return nil, e.vote(q.Challenge, q.Accept)
	case "pair":
		return nil, e.pair(q.Endpoint)
	case "bridge":
		name, err := e.openBridge(q.Endpoint)
		return map[string]any{"bridge": name}, err
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
