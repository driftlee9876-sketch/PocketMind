package link

import (
	"bytes"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"pocketmind/wifi/relay"
)

func TestInternetPairAndStream(t *testing.T) {
	url := os.Getenv("POCKETMIND_TEST_PUBLIC_RELAY")
	if url == "" {
		s := httptest.NewServer(relay.NewServer())
		defer s.Close()
		url = "ws" + strings.TrimPrefix(s.URL, "http") + "/gpu/v2"
	}
	donor := peer(t, t.TempDir())
	host := peer(t, t.TempDir())
	defer host.stop()
	defer donor.stop()
	donor.relayURL = url
	host.relayURL = url
	if err := donor.offerInternet(func() (net.Conn, error) {
		a, b := net.Pipe()
		go func() { defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}); err != nil {
		t.Fatal(err)
	}
	until := func(check func() bool) {
		t.Helper()
		deadline := time.Now().Add(100 * time.Second)
		for time.Now().Before(deadline) {
			if check() {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("relay timed out", donor.snapshot()["issue"], host.snapshot()["issue"])
	}
	var invite string
	until(func() bool { invite = donor.snapshot()["relayInvitation"].(string); return invite != "" })
	result, err := host.importInternet(invite)
	if err != nil {
		t.Fatal(err)
	}
	p := Endpoint{Relay: result["Relay"].(string), ID: result["ID"].(string)}
	if _, err = host.connectData(host.generation(), p); err == nil {
		t.Fatal("unpaired data accepted")
	}
	if err = host.pair(p); err != nil {
		t.Fatal(err)
	}
	until(func() bool {
		return host.snapshot()["pending"].(*challenge) != nil && donor.snapshot()["pending"].(*challenge) != nil
	})
	a, b := host.snapshot()["pending"].(*challenge), donor.snapshot()["pending"].(*challenge)
	if a.Code != b.Code {
		t.Fatal("pair codes differ")
	}
	host.vote(a.ID, true)
	donor.vote(b.ID, true)
	until(func() bool { return host.isTrusted(donor.id) && donor.isTrusted(host.id) })
	payload := bytes.Repeat([]byte("gpu tensor"), 65536)
	for i := 0; i < 2; i++ {
		c, err := host.connectData(host.generation(), p)
		if err != nil {
			t.Fatal(err)
		}
		c.SetDeadline(time.Now().Add(25 * time.Second))
		sent := make(chan error, 1)
		go func() { _, err := c.Write(payload); sent <- err }()
		got := make([]byte, len(payload))
		_, err = io.ReadFull(c, got)
		if err != nil || <-sent != nil || !bytes.Equal(got, payload) {
			t.Fatal("relay payload mismatch", err)
		}
		host.drop(c)
	}
	host.Command(Request{Op: "forget"})
	if len(host.snapshot()["internetPeers"].([]map[string]any)) != 0 {
		t.Fatal("forgotten invitation retained")
	}
}
