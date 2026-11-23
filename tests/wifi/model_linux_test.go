package link

import (
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Run the release protocol and RPC backend on private test interfaces. Only
// the physical accelerators are replaced by CPU-backed RPC devices in CI.
func TestWifiModelCompletion(t *testing.T) {
	var addresses []string
	for index, port := range []string{"16601", "16602"} {
		binary := os.Getenv("POCKETMIND_RPC")
		rpc := exec.Command(binary, "--host", "127.0.0.1", "--port", port, "--device", "CPU")
		rpc.Dir = filepath.Dir(binary)
		if err := rpc.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() { rpc.Process.Kill(); rpc.Wait() }()
		until := time.Now().Add(15 * time.Second)
		for {
			c, err := net.DialTimeout("tcp4", "127.0.0.1:"+port, time.Second)
			if err == nil {
				c.Close()
				break
			}
			if time.Now().After(until) {
				t.Fatal("RPC runtime did not start", err)
			}
			time.Sleep(100 * time.Millisecond)
		}
		host, donor := peer(t, t.TempDir()), peer(t, t.TempDir())
		defer host.stop()
		defer donor.stop()
		offer, err := donor.Command(Request{Op: "offer", Endpoint: Endpoint{Local: "192.168.246.2", Prefix: 24}, Backend: "windows", Value: port})
		if err != nil {
			t.Fatal(err)
		}
		target := Endpoint{Local: "192.168.246.1", Prefix: 24, IP: "192.168.246.2", ID: donor.id, Port: offer["port"].(int)}
		if err = host.pair(target); err != nil {
			t.Fatal(err)
		}
		h, d := pending(t, host), pending(t, donor)
		if h.Code != d.Code {
			t.Fatal("TLS channel codes differ")
		}
		if err = host.vote(h.ID, true); err != nil {
			t.Fatal(err)
		}
		if err = donor.vote(d.ID, true); err != nil {
			t.Fatal(err)
		}
		for !host.isTrusted(donor.id) || !donor.isTrusted(host.id) {
			if time.Now().After(until) {
				t.Fatal("missing approvals")
			}
			time.Sleep(time.Millisecond)
		}
		name, err := host.openBridge(target)
		if err != nil {
			t.Fatal(err)
		}
		// Desktop upstream llama connects to TCP. The Android build opens its
		// app-private abstract socket directly at this point in the same path.
		front, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer front.Close()
		addresses = append(addresses, front.Addr().String())
		go func() {
			for {
				c, err := front.Accept()
				if err != nil {
					return
				}
				go func() {
					defer c.Close()
					b, err := net.Dial("unix", "@"+name)
					if err != nil {
						return
					}
					defer b.Close()
					go func() { io.Copy(b, c); b.Close() }()
					io.Copy(c, b)
				}()
			}
		}()
		t.Log("Paired endpoint", index+1)
	}
	cmd := exec.Command("python3", os.Getenv("POCKETMIND_COMPLETION_TEST"), addresses[0], addresses[1])
	out, err := cmd.CombinedOutput()
	t.Log(string(out))
	if err != nil {
		t.Fatal(err)
	}
}
