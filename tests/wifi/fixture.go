// Test-only simulated donor. The model and app never include this program.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"time"

	"pocketmind/wifi/link"
)

func main() {
	e, err := link.New(os.Args[1])
	if err != nil {
		panic(err)
	}
	result, err := e.Command(link.Request{Op: "offer", Endpoint: link.Endpoint{Local: "192.168.246.2", Prefix: 24}, Backend: "windows", Value: "17654"})
	if err != nil {
		panic(err)
	}
	fmt.Println("ID", result["id"])
	front, err := net.Listen("tcp4", "127.0.0.1:17653")
	if err != nil {
		panic(err)
	}
	go func() {
		for {
			c, err := front.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				d := net.Dialer{LocalAddr: &net.TCPAddr{IP: net.ParseIP("192.168.246.1")}, Timeout: time.Second}
				b, err := d.Dial("tcp4", net.JoinHostPort("192.168.246.2", strconv.Itoa(result["port"].(int))))
				if err != nil {
					return
				}
				defer b.Close()
				go func() { io.Copy(b, c); b.Close() }()
				io.Copy(c, b)
			}()
		}
	}()
	var last string
	for {
		state, _ := e.Command(link.Request{Op: "status"})
		raw, _ := json.Marshal(state["pending"])
		var pending struct{ ID, Code string }
		json.Unmarshal(raw, &pending)
		if pending.ID != "" && pending.ID != last {
			last = pending.ID
			fmt.Println("CODE", pending.Code)
			if _, err = e.Command(link.Request{Op: "vote", Challenge: pending.ID, Accept: true}); err != nil {
				panic(err)
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
}
