//go:build !linux

package link

import (
	"errors"
	"net"
)

func localBridge() (net.Listener, string, error) {
	return nil, "", errors.New("모델 호스트는 Android에서 실행하세요.")
}
func ownUser(net.Conn) bool { return false }
