// Package relay carries PocketMind's device-to-device TLS over outbound WebSockets.
package relay

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

func ValidKey(s string) bool {
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	return err == nil && len(b) == 32
}
func Room(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
func config() *yamux.Config {
	cfg := yamux.DefaultConfig()
	cfg.LogOutput = io.Discard
	cfg.StreamOpenTimeout = 10 * time.Second
	cfg.MaxStreamWindowSize = 1 << 20
	return cfg
}

type socket struct {
	net.Conn
	ws *websocket.Conn
}

func (s *socket) Close() error { return s.ws.CloseNow() }
func binarySocket(ctx context.Context, ws *websocket.Conn) net.Conn {
	return &socket{websocket.NetConn(ctx, ws, websocket.MessageBinary), ws}
}
func dial(ctx context.Context, base, role, key string) (net.Conn, error) {
	start, cancel := context.WithTimeout(ctx, 85*time.Second)
	defer cancel()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ws, resp, err := websocket.Dial(start, base+"/"+role, &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + key}}})
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusNotFound {
			return nil, errors.New("보조 기기에서 원격 GPU 제공을 켜 주세요.")
		}
		return nil, errors.New("PocketMind 중계 서버에 연결할 수 없어요.")
	}
	return binarySocket(ctx, ws), nil
}
func Provider(ctx context.Context, base, secret string) (*yamux.Session, error) {
	c, err := dial(ctx, base, "offer", secret)
	if err != nil {
		return nil, err
	}
	s, err := yamux.Server(c, config())
	if err != nil {
		c.Close()
		return nil, err
	}
	if _, err = s.Ping(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}
func Connect(ctx context.Context, base, room string) (net.Conn, error) {
	return dial(ctx, base, "connect", room)
}
