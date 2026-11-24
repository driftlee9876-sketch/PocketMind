package link

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

type groupKey [32]byte

func (k groupKey) tag() string {
	if k == (groupKey{}) {
		return ""
	}
	h := sha256.Sum256(k[:])
	return base64.RawURLEncoding.EncodeToString(h[:12])
}
func (e *Engine) loadGroup() error {
	raw, err := os.ReadFile(filepath.Join(e.dir, "nearby.group"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(raw) != 32 {
		return errors.New("기기 그룹 파일을 읽지 못했어요.")
	}
	copy(e.group[:], raw)
	return nil
}
func (e *Engine) saveGroupLocked(k groupKey) error {
	if e.group == k {
		return nil
	}
	if err := atomicWrite(filepath.Join(e.dir, "nearby.group"), k[:]); err != nil {
		return err
	}
	e.group = k
	return nil
}

// Exchange group credentials only after both operators have entered the peer's code.
func (e *Engine) join(c *tls.Conn, gen uint64, session []byte) error {
	e.mu.Lock()
	key := e.group
	e.mu.Unlock()
	var tag, peerTag [16]byte
	copy(tag[:], key.tag())
	if _, err := c.Write(tag[:]); err != nil {
		return err
	}
	if _, err := io.ReadFull(c, peerTag[:]); err != nil {
		return err
	}
	if tag != ([16]byte{}) && peerTag != ([16]byte{}) && tag != peerTag {
		return errors.New("이미 서로 다른 그룹에 있어요. 한쪽에서 기존 그룹을 나간 뒤 다시 연결하세요.")
	}
	if _, err := c.Write(key[:]); err != nil {
		return err
	}
	var other groupKey
	if _, err := io.ReadFull(c, other[:]); err != nil {
		return err
	}
	switch {
	case key == (groupKey{}) && other == (groupKey{}):
		copy(key[:], session)
	case key == (groupKey{}):
		key = other
	case other != (groupKey{}) && key != other:
		return errors.New("이미 서로 다른 그룹에 있어요. 한쪽에서 기존 그룹을 나간 뒤 다시 연결하세요.")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if gen != e.epoch {
		return denied
	}
	return e.saveGroupLocked(key)
}

func groupProof(c *tls.Conn, key groupKey, client bool) error {
	if key == (groupKey{}) {
		return denied
	}
	state := c.ConnectionState()
	session, err := state.ExportKeyingMaterial("EXPORTER-PocketMind-group-data", nil, 32)
	if err != nil {
		return err
	}
	mac := func(role byte) []byte {
		h := hmac.New(sha256.New, key[:])
		h.Write(session)
		h.Write([]byte{role})
		return h.Sum(nil)
	}
	send, receive := byte(0), byte(1)
	if !client {
		send, receive = receive, send
	}
	if _, err = c.Write(mac(send)); err != nil {
		return err
	}
	var got [32]byte
	if _, err = io.ReadFull(c, got[:]); err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(got[:], mac(receive)) != 1 {
		return denied
	}
	return nil
}

// Presence stays available while a host is running. Advertising never starts a GPU.
func (e *Engine) presence(p Endpoint) (map[string]any, error) {
	subnet, err := p.network()
	if err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	addr := net.JoinHostPort(p.Local, "0")
	if e.nearby != nil && e.nearby.Addr().(*net.TCPAddr).IP.String() != p.Local {
		e.nearby.Close()
		e.nearby = nil
	}
	if e.nearby == nil {
		l, err := net.Listen("tcp4", addr)
		if err != nil {
			return nil, err
		}
		e.nearby = l
		go func() {
			cfg := e.serverConfig()
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
				gen := e.generation()
				if e.track(gen, c) {
					go e.accept(gen, c, e.nearbyBackend)
				}
			}
		}()
	}
	return map[string]any{"port": e.nearby.Addr().(*net.TCPAddr).Port, "id": e.id, "group": e.group.tag()}, nil
}
func (e *Engine) nearbyBackend() (net.Conn, error) {
	e.mu.Lock()
	if len(e.bridges) > 0 {
		e.mu.Unlock()
		return nil, denied
	}
	backend := e.attached
	if backend == nil {
		e.wanted++
		defer func() { e.mu.Lock(); e.wanted--; e.mu.Unlock() }()
	}
	ctx := e.outboundCtx
	e.mu.Unlock()
	if backend == nil {
		timer := time.NewTimer(40 * time.Second)
		defer timer.Stop()
		tick := time.NewTicker(100 * time.Millisecond)
		defer tick.Stop()
		for backend == nil {
			select {
			case <-timer.C:
				return nil, denied
			case <-ctx.Done():
				return nil, denied
			case <-tick.C:
			}
			e.mu.Lock()
			backend = e.attached
			e.mu.Unlock()
		}
	}
	return backend()
}

func (e *Engine) enter(id, code string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.pending == nil || id != e.pending.ID || e.pending.submitted {
		return denied
	}
	good := len(code) == 6 && bytes.Equal([]byte(code), []byte(e.pending.expected))
	e.pending.submitted = true
	e.pending.vote <- good
	if !good {
		return errors.New("상대 기기의 코드가 달라요. 다시 연결해 새 코드를 입력하세요.")
	}
	return nil
}
