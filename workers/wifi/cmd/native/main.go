package main

/*
#include <stdlib.h>
*/
import "C"
import (
	"encoding/json"
	"errors"
	"pocketmind/wifi/link"
	"sync"
	"unsafe"
)

var lock sync.Mutex
var engine *link.Engine

func run(s string) (map[string]any, error) {
	var q link.Request
	if err := json.Unmarshal([]byte(s), &q); err != nil {
		return nil, err
	}
	lock.Lock()
	if q.Op == "init" && engine == nil {
		var err error
		engine, err = link.New(q.Dir)
		if err != nil {
			lock.Unlock()
			return nil, err
		}
	}
	e := engine
	lock.Unlock()
	if e == nil {
		return nil, errors.New("GPU 연결 설정을 열 수 없어요.")
	}
	if q.Op == "init" {
		q.Op = "status"
	}
	return e.Command(q)
}

//export PMWifi
func PMWifi(input *C.char) *C.char {
	r, err := run(C.GoString(input))
	if err != nil {
		r = map[string]any{"error": err.Error()}
	}
	if r == nil {
		r = map[string]any{}
	}
	b, _ := json.Marshal(r)
	return C.CString(string(b))
}

//export PMWifiFree
func PMWifiFree(p *C.char) { C.free(unsafe.Pointer(p)) }
func main()                {}
