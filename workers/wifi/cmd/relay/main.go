package main

import (
	"log"
	"net/http"
	"os"
	"pocketmind/wifi/relay"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	s := http.Server{Addr: ":" + port, Handler: relay.NewServer(), ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	log.Fatal(s.ListenAndServe())
}
