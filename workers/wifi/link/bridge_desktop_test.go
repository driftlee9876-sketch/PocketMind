//go:build windows || darwin

package link

import (
	"net"
	"strings"
	"testing"
)

func TestLocalHostCanUseBridge(t *testing.T) {
	l, route, err := localBridge()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	parts := strings.Split(route, "/")
	c, err := net.Dial("tcp4", parts[0])
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if len(parts) == 2 {
		if _, err = c.Write([]byte(parts[1])); err != nil {
			t.Fatal(err)
		}
	}
	server, err := l.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if !ownUser(server) {
		t.Fatal("local model could not open the private bridge")
	}
}
