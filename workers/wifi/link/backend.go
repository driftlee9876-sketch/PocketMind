package link

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"regexp"
	"strconv"
	"time"
)

func localBackend(kind, value string) (Backend, error) {
	switch kind {
	case "android":
		if !regexp.MustCompile("^[0-9]{8}$").MatchString(value) {
			return nil, denied
		}
		return func() (net.Conn, error) { return net.DialTimeout("unix", "@pocketmind_gpu_"+value, 3*time.Second) }, nil
	case "windows":
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 {
			return nil, denied
		}
		return func() (net.Conn, error) {
			return net.DialTimeout("tcp4", fmt.Sprintf("127.0.0.1:%d", port), 3*time.Second)
		}, nil
	case "ios":
		b, err := hex.DecodeString(value)
		if err != nil || len(b) != 32 {
			return nil, denied
		}
		return func() (net.Conn, error) {
			c, err := net.DialTimeout("tcp4", "127.0.0.1:18790", 3*time.Second)
			if err != nil {
				return nil, err
			}
			c.SetDeadline(time.Now().Add(5 * time.Second))
			_, err = fmt.Fprintf(c, "RPC %s\n", value)
			var ok [3]byte
			if err == nil {
				_, err = io.ReadFull(c, ok[:])
			}
			if err != nil || string(ok[:]) != "OK\n" {
				c.Close()
				return nil, denied
			}
			c.SetDeadline(time.Time{})
			return c, nil
		}, nil
	}
	return nil, errors.New("알 수 없는 로컬 GPU입니다.")
}
