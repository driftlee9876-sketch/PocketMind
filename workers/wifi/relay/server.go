package relay

import (
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

type Server struct {
	mu    sync.Mutex
	rooms map[string]*yamux.Session
	slots chan struct{}
}

func NewServer() *Server {
	return &Server{rooms: make(map[string]*yamux.Session), slots: make(chan struct{}, 512)}
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"service":"pocketmind-gpu-relay","protocol":2}`)
		return
	}
	role := strings.TrimPrefix(r.URL.Path, "/gpu/v2/")
	if r.Method != "GET" || (role != "offer" && role != "connect") {
		http.NotFound(w, r)
		return
	}
	key, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || !ValidKey(key) || r.Header.Get("Origin") != "" {
		http.Error(w, "invalid invitation", 403)
		return
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		http.Error(w, "busy", 503)
		return
	}
	if role == "offer" {
		s.offer(w, r, Room(key))
		return
	}
	s.mu.Lock()
	session := s.rooms[key]
	s.mu.Unlock()
	if session == nil {
		http.Error(w, "provider offline", 404)
		return
	}
	if session.NumStreams() >= 64 {
		http.Error(w, "provider busy", 429)
		return
	}
	stream, err := session.Open()
	if err != nil {
		http.Error(w, "provider offline", 503)
		return
	}
	defer stream.Close()
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn := binarySocket(r.Context(), ws)
	defer conn.Close()
	done := make(chan struct{})
	go func() { io.Copy(conn, stream); conn.Close(); stream.Close(); close(done) }()
	io.Copy(stream, conn)
	stream.Close()
	conn.Close()
	<-done
}
func (s *Server) offer(w http.ResponseWriter, r *http.Request, room string) {
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn := binarySocket(r.Context(), ws)
	defer conn.Close()
	session, err := yamux.Client(conn, config())
	if err != nil {
		return
	}
	defer session.Close()
	s.mu.Lock()
	old := s.rooms[room]
	s.rooms[room] = session
	s.mu.Unlock()
	if old != nil {
		old.Close()
	}
	select {
	case <-session.CloseChan():
	case <-r.Context().Done():
	}
	s.mu.Lock()
	if s.rooms[room] == session {
		delete(s.rooms, room)
	}
	s.mu.Unlock()
}
