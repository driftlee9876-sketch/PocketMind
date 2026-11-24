package link

import (
	"crypto/rand"
	"encoding/hex"
	"net"
	"os"
	"syscall"
)

func localBridge() (net.Listener, string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, "", err
	}
	name := "pocketmind_host_" + hex.EncodeToString(b[:])
	l, err := net.Listen("unix", "@"+name)
	return l, name, err
}
func ownUser(c net.Conn) bool {
	u, ok := c.(*net.UnixConn)
	if !ok {
		return false
	}
	r, err := u.SyscallConn()
	if err != nil {
		return false
	}
	match := false
	err = r.Control(func(fd uintptr) {
		cred, err := syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
		match = err == nil && int(cred.Uid) == os.Getuid()
	})
	return err == nil && match
}
