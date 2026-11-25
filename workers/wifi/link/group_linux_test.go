package link

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestMeshBoundaries(t *testing.T) {
	h := peer(t, t.TempDir())
	p := Endpoint{Mesh: true, Local: "100.65.1.2", IP: "100.110.31.4", Port: meshPort, ID: h.id}
	if err := p.validate(); err != nil {
		t.Fatal(err)
	}
	for _, ip := range []string{"100.63.255.255", "100.128.0.1", "8.8.8.8", p.Local} {
		x := p
		x.IP = ip
		if x.validate() == nil {
			t.Fatal("invalid destination", ip)
		}
	}
	if _, err := h.openBridges(make([]Endpoint, 21)); err == nil {
		t.Fatal("21 peers accepted")
	}
}

func TestTwentyMeshPeers(t *testing.T) {
	if os.Getenv("POCKETMIND_TEST_MESH") != "1" {
		t.Skip("requires 21 CI VPN interface addresses")
	}
	h := peer(t, t.TempDir())
	defer h.stop()
	runtime := os.Getenv("POCKETMIND_TEST_GPU_BIN")
	var peers []Endpoint
	for i := 1; i <= 20; i++ {
		donor := peer(t, t.TempDir())
		defer donor.stop()
		ip := fmt.Sprintf("100.70.%d.2", i)
		backend := func() (net.Conn, error) {
			a, b := net.Pipe()
			go func() { defer b.Close(); fmt.Fprintf(b, "%02d", i); io.Copy(b, b) }()
			return a, nil
		}
		if runtime != "" {
			code := fmt.Sprintf("%08d", i)
			proc := exec.Command(filepath.Join(runtime, "ggml-rpc-server"), "-d", "CPU", "-t", "1")
			proc.Env = append(os.Environ(), "POCKETMIND_USB_SOCKET=pocketmind_gpu_"+code)
			if err := proc.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { proc.Process.Kill(); proc.Wait() }()
			var err error
			backend, err = localBackend("android", code)
			if err != nil {
				t.Fatal(err)
			}
		}
		port, err := donor.offer(Endpoint{Mesh: true, Local: ip}, backend)
		if err != nil {
			t.Fatal(err)
		}
		p := Endpoint{Mesh: true, Local: "100.69.0.1", IP: ip, Port: port, ID: donor.id}
		if err = h.pair(p); err != nil {
			t.Fatal(err)
		}
		a, b := pending(t, h), pending(t, donor)
		if a.expected != b.Code {
			t.Fatal("different approval codes")
		}
		if err = h.enter(a.ID, b.Code); err != nil {
			t.Fatal(err)
		}
		if err = donor.enter(b.ID, a.Code); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(5 * time.Second)
		for {
			if h.snapshot()["pending"].(*challenge) == nil && donor.snapshot()["pending"].(*challenge) == nil && h.isTrusted(donor.id) && donor.isTrusted(h.id) {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("approval timeout")
			}
			time.Sleep(time.Millisecond)
		}
		peers = append(peers, p)
	}
	duplicate := append([]Endpoint{}, peers...)
	duplicate[19] = duplicate[0]
	if _, err := h.openBridges(duplicate); err == nil {
		t.Fatal("duplicate peer accepted")
	}
	names, err := h.openBridges(peers)
	if err != nil || len(names) != 20 {
		t.Fatal("group startup", err)
	}
	if runtime != "" {
		runModelOnGroup(t, runtime, names)
		return
	}
	for i, name := range names {
		c, err := net.Dial("unix", "@"+name)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(3 * time.Second))
		b := make([]byte, 2)
		if _, err = io.ReadFull(c, b); err != nil || string(b) != fmt.Sprintf("%02d", i+1) {
			t.Fatal("wrong donor", i, err)
		}
		c.Write([]byte("ok"))
		if _, err = io.ReadFull(c, b); err != nil || string(b) != "ok" {
			t.Fatal("data relay", i, err)
		}
	}
}

func runModelOnGroup(t *testing.T, runtime string, names []string) {
	t.Helper()
	env := os.Environ()
	var endpoints, devices, split []string
	for i, name := range names {
		key := "POCKETMIND_HOST_SOCKET"
		if i > 0 {
			key += fmt.Sprintf("_%d", i)
		}
		env = append(env, key+"="+name)
		endpoints = append(endpoints, fmt.Sprintf("127.0.0.1:%d", 50052+i))
		devices = append(devices, fmt.Sprintf("RPC%d", i))
		split = append(split, "1")
	}
	path := filepath.Join(t.TempDir(), "inference.log")
	log, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	host := exec.Command(filepath.Join(runtime, "llama-server"), "--rpc", strings.Join(endpoints, ","), "--device", strings.Join(devices, ","), "--tensor-split", strings.Join(split, ","), "--split-mode", "layer", "-ngl", "99", "-m", os.Getenv("POCKETMIND_TEST_MODEL"), "-t", "1", "-c", "128", "--port", "18491", "-lv", "4")
	host.Env = env
	host.Stdout = log
	host.Stderr = log
	if err = host.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		host.Process.Kill()
		host.Wait()
		if t.Failed() {
			raw, _ := os.ReadFile(path)
			if len(raw) > 5000 {
				raw = raw[len(raw)-5000:]
			}
			t.Log(string(raw))
		}
	}()
	client := http.Client{Timeout: 30 * time.Second}
	until := time.Now().Add(90 * time.Second)
	for {
		r, err := client.Get("http://127.0.0.1:18491/health")
		if err == nil {
			r.Body.Close()
			if r.StatusCode == 200 {
				break
			}
		}
		if time.Now().After(until) {
			t.Fatal("failed to load model")
		}
		time.Sleep(250 * time.Millisecond)
	}
	r, err := client.Post("http://127.0.0.1:18491/completion", "application/json", bytes.NewBufferString(`{"prompt":"Once upon a time","n_predict":4,"temperature":0}`))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var response struct {
		Tokens int `json:"tokens_predicted"`
	}
	if err = json.NewDecoder(r.Body).Decode(&response); err != nil || response.Tokens < 1 {
		t.Fatal("generation", err, response)
	}
	raw, _ := os.ReadFile(path)
	allocated := map[string]bool{}
	for _, match := range regexp.MustCompile(`RPC\d+\[(127\.0\.0\.1:\d+)\]\s+model buffer size\s*=\s*([\d.]+) MiB`).FindAllStringSubmatch(string(raw), -1) {
		if strings.Trim(match[2], "0.") != "" {
			allocated[match[1]] = true
		}
	}
	if len(allocated) != 20 {
		t.Fatalf("nonzero model allocation on %d/20 peers", len(allocated))
	}
	t.Logf("All 20 authenticated remote backends held model weights and generated %d tokens", response.Tokens)
}
