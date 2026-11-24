package link

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"pocketmind/wifi/relay"
)

const publicRelay = "wss://pocketmind-gpu-relay.onrender.com/gpu/v2"

func (e *Engine) loadInvites() error {
	e.invites = make(map[string]string)
	b, err := os.ReadFile(filepath.Join(e.dir, "internet-peers.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(b, &e.invites)
}
func (e *Engine) saveInviteLocked(id, room string) error {
	peers := make(map[string]string)
	if id != "" {
		for k, v := range e.invites {
			peers[k] = v
		}
		peers[id] = room
		if len(peers) > maxPeers {
			return errors.New("저장할 수 있는 보조 기기는 최대 20대예요.")
		}
	}
	b, err := json.Marshal(peers)
	if err != nil {
		return err
	}
	if err = atomicWrite(filepath.Join(e.dir, "internet-peers.json"), b); err != nil {
		return err
	}
	e.invites = peers
	return nil
}
func (e *Engine) importInternet(invite string) (map[string]any, error) {
	f := strings.Split(strings.TrimSpace(invite), "|")
	if len(f) != 3 || f[0] != "pmgpu2" || !relay.ValidKey(f[1]) || !relay.ValidKey(f[2]) || f[2] == e.id {
		return nil, errors.New("다른 기기의 PocketMind 원격 초대를 붙여넣으세요.")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.saveInviteLocked(f[2], f[1]); err != nil {
		return nil, err
	}
	return internetPeer(f[2], f[1]), nil
}
func internetPeer(id, room string) map[string]any {
	return map[string]any{"ID": id, "Relay": room, "name": "원격 GPU · " + id[:6], "platform": "PocketMind"}
}

func (e *Engine) offerInternet(backend Backend) error {
	e.mu.Lock()
	if e.listener != nil || e.relayCancel != nil || len(e.bridges) > 0 {
		e.mu.Unlock()
		return errors.New("GPU 연결이 이미 실행 중이에요.")
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.relayCancel = cancel
	mac := hmac.New(sha256.New, e.cert.PrivateKey.(ed25519.PrivateKey).Seed())
	mac.Write([]byte("PocketMind outbound relay registration v2"))
	secret := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	invite := "pmgpu2|" + relay.Room(secret) + "|" + e.id
	epoch := e.epoch
	e.mu.Unlock()
	go func() {
		delay := time.Second
		for ctx.Err() == nil {
			s, err := relay.Provider(ctx, e.relayURL, secret)
			if err == nil {
				delay = time.Second
				e.mu.Lock()
				if e.epoch != epoch {
					e.mu.Unlock()
					s.Close()
					return
				}
				e.invitation = invite
				e.issue = ""
				e.mu.Unlock()
				for {
					raw, err := s.Accept()
					if err != nil {
						break
					}
					c := tls.Server(raw, e.serverConfig())
					if e.track(epoch, c) {
						go e.accept(epoch, c, backend)
					}
				}
				s.Close()
			}
			e.mu.Lock()
			if e.epoch != epoch {
				e.mu.Unlock()
				return
			}
			e.invitation = ""
			e.issue = "중계 서버에 다시 연결하는 중이에요."
			e.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			if delay < 16*time.Second {
				delay *= 2
			}
		}
	}()
	return nil
}
