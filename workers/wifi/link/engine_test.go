package link

import (
	"crypto/tls"
	"io"
	"net"
	"testing"
	"time"
)

func peer(t *testing.T, dir string) *Engine {
	t.Helper()
	e, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	return e
}
func connect(t *testing.T, a, b *Engine, backend Backend) *tls.Conn {
	t.Helper()
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		l.Close()
		s := tls.Server(c, &tls.Config{Certificates: []tls.Certificate{b.cert}, ClientAuth: tls.RequireAnyClientCert, MinVersion: tls.VersionTLS13, NextProtos: []string{protocol}})
		gen := b.generation()
		if b.track(gen, s) {
			b.accept(gen, s, backend)
		}
	}()
	c, err := tls.Dial("tcp4", l.Addr().String(), &tls.Config{Certificates: []tls.Certificate{a.cert}, InsecureSkipVerify: true, NextProtos: []string{protocol}, VerifyConnection: func(cs tls.ConnectionState) error {
		if pin(cs.PeerCertificates[0]) != b.id {
			return denied
		}
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func pending(t *testing.T, e *Engine) *challenge {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		e.mu.Lock()
		p := e.pending
		e.mu.Unlock()
		if p != nil {
			return p
		}
		time.Sleep(time.Millisecond * 5)
	}
	t.Fatal("missing challenge")
	return nil
}
func TestPairReconnectForget(t *testing.T) {
	da, db := t.TempDir(), t.TempDir()
	a, b := peer(t, da), peer(t, db)
	backend := func() (net.Conn, error) {
		x, y := net.Pipe()
		go func() { defer y.Close(); io.Copy(y, y) }()
		return x, nil
	}
	tryData := func(want bool) {
		t.Helper()
		c := connect(t, a, b, backend)
		defer c.Close()
		c.SetDeadline(time.Now().Add(3 * time.Second))
		_, _ = c.Write([]byte("D"))
		err := byteIs(c, 'K')
		if (err == nil) != want {
			t.Fatalf("data permission %v error %v", want, err)
		}
		if want {
			c.Write([]byte("rpc"))
			buf := make([]byte, 3)
			if _, err := io.ReadFull(c, buf); err != nil || string(buf) != "rpc" {
				t.Fatal("RPC relay", err)
			}
		}
	}
	tryData(false)
	for _, allow := range []bool{false, true} {
		c := connect(t, a, b, backend)
		c.Write([]byte("P"))
		done := make(chan error, 1)
		go func() { done <- a.consent(a.generation(), c, b.id); c.Close() }()
		p, q := pending(t, a), pending(t, b)
		if p.Code != q.Code || p.ID == q.ID {
			t.Fatal("TLS channel binding mismatch")
		}
		if a.vote("stale", true) == nil {
			t.Fatal("stale approval accepted")
		}
		if allow {
			a.vote(p.ID, true)
		}
		b.vote(q.ID, allow)
		var err error
		select {
		case err = <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("remote rejection or approval did not reach host")
		}
		if (err == nil) != allow {
			t.Fatalf("approval %v: %v", allow, err)
		}
		if !allow {
			tryData(false)
		}
	}
	a.stop()
	b.stop()
	a, b = peer(t, da), peer(t, db)
	tryData(true)
	impostor := peer(t, t.TempDir())
	real := a
	a = impostor
	tryData(false)
	a = real
	if _, err := b.Command(Request{Op: "forget"}); err != nil {
		t.Fatal(err)
	}
	tryData(false)
}
func TestWifiBoundary(t *testing.T) {
	a := peer(t, t.TempDir())
	p := Endpoint{Local: "192.168.50.4", Prefix: 24, IP: "192.168.50.7", Port: 5555, ID: a.id}
	if err := p.validate(); err != nil {
		t.Fatal(err)
	}
	for _, ip := range []string{"192.168.50.0", "192.168.50.255", "192.168.51.7", "127.0.0.1", "192.168.50.4", "8.8.8.8", "bad"} {
		p.IP = ip
		if p.validate() == nil {
			t.Fatal(ip)
		}
	}
}
