package link

import (
	"encoding/binary"
	"net"
	"syscall"
	"unsafe"
)

var tcpTable = syscall.NewLazyDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")

func localBridge() (net.Listener, string, error) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}
	return l, l.Addr().String(), nil
}

// Match both ends of the client TCP connection and check its process token.
// Loopback alone also admits processes belonging to other signed-in users.
func ownUser(c net.Conn) bool {
	client := c.RemoteAddr().(*net.TCPAddr)
	server := c.LocalAddr().(*net.TCPAddr)
	var size uint32
	for i := 0; i < 3; i++ {
		var data []byte
		var ptr uintptr
		if size > 0 {
			if size > 64<<20 {
				return false
			}
			data = make([]byte, size)
			ptr = uintptr(unsafe.Pointer(&data[0]))
		}
		code, _, _ := tcpTable.Call(ptr, uintptr(unsafe.Pointer(&size)), 0, syscall.AF_INET, 5, 0)
		if code == 122 {
			continue
		}
		if code != 0 || len(data) < 4 {
			return false
		}
		count := binary.LittleEndian.Uint32(data)
		for row := 4; count > 0 && row+24 <= len(data); row, count = row+24, count-1 {
			r := data[row : row+24]
			if !net.IP(r[4:8]).Equal(client.IP) || !net.IP(r[12:16]).Equal(server.IP) ||
				int(binary.BigEndian.Uint16(r[8:])) != client.Port || int(binary.BigEndian.Uint16(r[16:])) != server.Port {
				continue
			}
			process, err := syscall.OpenProcess(0x1000, false, binary.LittleEndian.Uint32(r[20:]))
			if err != nil {
				return false
			}
			defer syscall.CloseHandle(process)
			var token syscall.Token
			if syscall.OpenProcessToken(process, syscall.TOKEN_QUERY, &token) != nil {
				return false
			}
			defer token.Close()
			current, err := syscall.OpenCurrentProcessToken()
			if err != nil {
				return false
			}
			defer current.Close()
			a, err := token.GetTokenUser()
			if err != nil {
				return false
			}
			b, err := current.GetTokenUser()
			if err != nil {
				return false
			}
			x, err := a.User.Sid.String()
			y, err2 := b.User.Sid.String()
			return err == nil && err2 == nil && x == y
		}
		return false
	}
	return false
}
