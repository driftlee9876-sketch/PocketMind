// Darwin has no abstract Unix sockets. A per-listener capability protects the
// loopback socket, including from other apps on the same device.
package link

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"net"
	"time"
)

type appleListener struct {
	net.Listener
	key string
}
type appleConnection struct {
	net.Conn
	key string
}

func (l appleListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return appleConnection{c, l.key}, nil
}
func localBridge() (net.Listener, string, error) {
	var secret [24]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, "", err
	}
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}
	key := hex.EncodeToString(secret[:])
	return appleListener{l, key}, l.Addr().String() + "/" + key, nil
}
func ownUser(conn net.Conn) bool {
	c, ok := conn.(appleConnection)
	if !ok {
		return false
	}
	data := make([]byte, len(c.key))
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, err := io.ReadFull(c, data)
	c.SetReadDeadline(time.Time{})
	return err == nil && subtle.ConstantTimeCompare(data, []byte(c.key)) == 1
}
