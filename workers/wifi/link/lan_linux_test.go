package link

import (
	"io"
	"net"
	"os"
	"testing"
	"time"
)

// CI assigns two private addresses to its loopback device. This exercises the
// production listener, address-bound dialer and UID-restricted Android bridge.
func TestPairedLANBridge(t *testing.T) {
	if os.Getenv("POCKETMIND_TEST_WIFI_LINK") != "1" {
		t.Skip("requires the two CI network addresses")
	}
	hostDir, donorDir := t.TempDir(), t.TempDir()
	host, donor := peer(t, hostDir), peer(t, donorDir)
	defer func() { host.stop(); donor.stop() }()
	backend := func() (net.Conn, error) {
		a, b := net.Pipe()
		go func() { defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}
	offer := func() Endpoint {
		t.Helper()
		port, err := donor.offer(Endpoint{Local: "192.168.246.2", Prefix: 24}, backend)
		if err != nil {
			t.Fatal(err)
		}
		return Endpoint{Local: "192.168.246.1", Prefix: 24, IP: "192.168.246.2", ID: donor.id, Port: port}
	}
	endpoint := offer()
	if _, err := host.openBridge(endpoint); err == nil {
		t.Fatal("unapproved bridge opened")
	}
	if err := host.pair(endpoint); err != nil {
		t.Fatal(err)
	}
	h, d := pending(t, host), pending(t, donor)
	if h.Code != d.Code {
		t.Fatal("on-screen codes differ")
	}
	if err := host.vote(h.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := donor.vote(d.ID, true); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(4 * time.Second)
	for !(host.isTrusted(donor.id) && donor.isTrusted(host.id)) {
		if time.Now().After(deadline) {
			t.Fatal("pairing timed out")
		}
		time.Sleep(time.Millisecond)
	}
	host.stop()
	donor.stop()
	host, donor = peer(t, hostDir), peer(t, donorDir)
	endpoint = offer()
	wrong := endpoint
	wrong.ID = host.id
	if c, err := host.dial(host.generation(), wrong); err == nil {
		c.Close()
		t.Fatal("accepted different public key")
	}
	name, err := host.openBridge(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	client, err := net.DialTimeout("unix", "@"+name, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err = client.Write([]byte("round-trip")); err != nil {
		t.Fatal(err)
	}
	result := make([]byte, 10)
	if _, err = io.ReadFull(client, result); err != nil || string(result) != "round-trip" {
		t.Fatalf("bridge data %q: %v", result, err)
	}
	if _, err = donor.Command(Request{Op: "forget"}); err != nil {
		t.Fatal(err)
	}
	if _, err = client.Read(result); err == nil {
		t.Fatal("revocation left stream open")
	} else if n, ok := err.(net.Error); ok && n.Timeout() {
		t.Fatal("revocation timed out")
	}
	endpoint = offer()
	if c, err := host.connectData(host.generation(), endpoint); err == nil {
		c.Close()
		t.Fatal("forgotten host reconnected")
	}
}
