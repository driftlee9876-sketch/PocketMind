// This fixture runs a separate PocketMind transport process on each simulated LAN.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"pocketmind/wifi/link"
)

func check(err error) {
	if err != nil {
		panic(err)
	}
}
func main() {
	side, dir := os.Args[1], os.Args[2]
	engine, err := link.New(filepath.Join(dir, side))
	check(err)
	defer engine.Command(link.Request{Op: "stop"})
	call := func(q link.Request) map[string]any { v, err := engine.Command(q); check(err); return v }
	file := func(name, text string) {
		p := filepath.Join(dir, name)
		check(os.WriteFile(p+".new", []byte(text), 0600))
		check(os.Rename(p+".new", p))
	}
	read := func(name string) string { b, _ := os.ReadFile(filepath.Join(dir, name)); return string(b) }
	until := func(fn func() bool) {
		end := time.Now().Add(25 * time.Second)
		for !fn() {
			if time.Now().After(end) {
				panic("fixture timed out on " + side)
			}
			time.Sleep(30 * time.Millisecond)
		}
	}
	if side == "donor" {
		l, err := net.Listen("tcp4", "127.0.0.1:18317")
		check(err)
		defer l.Close()
		go func() {
			c, err := l.Accept()
			if err != nil {
				return
			}
			defer c.Close()
			var b [6]byte
			if _, err = io.ReadFull(c, b[:]); err == nil {
				io.WriteString(c, strings.ToUpper(string(b[:])))
			}
		}()
		v := call(link.Request{Op: "offer", Endpoint: link.Endpoint{Mesh: true, Local: "100.83.5.7"}, Backend: "windows", Value: "18317"})
		file("id", v["id"].(string))
	} else {
		until(func() bool { return len(read("id")) == 43 })
	}
	endpoint := link.Endpoint{Mesh: true, Local: "100.74.4.9", IP: "100.83.5.7", ID: read("id"), Port: 47832}
	if side == "host" {
		call(link.Request{Op: "pair", Endpoint: endpoint})
	}
	other := "host"
	if side == "host" {
		other = "donor"
	}
	var challenge struct{ ID, Code string }
	until(func() bool {
		raw, _ := json.Marshal(call(link.Request{Op: "status"})["pending"])
		json.Unmarshal(raw, &challenge)
		return challenge.ID != ""
	})
	file(side+"-code", challenge.Code)
	until(func() bool { return read(other+"-code") != "" })
	if challenge.Code != read(other+"-code") {
		panic("codes differ")
	}
	call(link.Request{Op: "vote", Challenge: challenge.ID, Accept: true})
	until(func() bool { return len(call(link.Request{Op: "status"})["trusted"].([]string)) == 1 })
	if side == "donor" {
		file("approved", "1")
		until(func() bool { return read("done") == "1" })
		return
	}
	until(func() bool { return read("approved") == "1" })
	names := call(link.Request{Op: "bridges", Endpoints: []link.Endpoint{endpoint}})["bridges"].([]string)
	c, err := net.Dial("unix", "@"+names[0])
	check(err)
	defer c.Close()
	c.SetDeadline(time.Now().Add(4 * time.Second))
	_, err = io.WriteString(c, "remote")
	check(err)
	var answer [6]byte
	_, err = io.ReadFull(c, answer[:])
	check(err)
	if string(answer[:]) != "REMOTE" {
		panic("unexpected response")
	}
	file("done", "1")
	fmt.Println("Matched both approval codes and exchanged authenticated GPU transport data across separate routed LANs")
}
