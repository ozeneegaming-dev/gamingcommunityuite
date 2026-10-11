package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"runtime/debug"
	"sync"
	"time"
)

// job is a conversion running in the background.
type job struct {
	mu      sync.Mutex
	log     bytes.Buffer
	done    bool
	result  guiResult
	started time.Time
}

func (j *job) Write(p []byte) (int, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.log.Write(p)
}

func (j *job) status() map[string]any {
	j.mu.Lock()
	defer j.mu.Unlock()
	st := map[string]any{"done": j.done, "log": j.log.String(), "seconds": int(time.Since(j.started).Seconds())}
	if j.done {
		st["result"] = j.result
	}
	return st
}

var (
	jobsMu sync.Mutex
	jobs   = map[string]*job{}
)

// startJob runs body in the background, one conversion at a time (lock), and returns its id. A crash inside a
// conversion is reported in the log instead of taking the program down.
func startJob(lock *sync.Mutex, body func(live io.Writer) guiResult) string {
	b := make([]byte, 8)
	rand.Read(b)
	id := hex.EncodeToString(b)
	j := &job{started: time.Now()}
	jobsMu.Lock()
	jobs[id] = j
	// Forget finished jobs older than an hour.
	for k, old := range jobs {
		old.mu.Lock()
		stale := old.done && time.Since(old.started) > time.Hour
		old.mu.Unlock()
		if stale {
			delete(jobs, k)
		}
	}
	jobsMu.Unlock()
	go func() {
		lock.Lock()
		defer lock.Unlock()
		var res guiResult
		func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Fprintf(j, "\nEROARE internă: %v\n%s\n", r, debug.Stack())
					res = guiResult{}
				}
			}()
			res = body(j)
		}()
		j.mu.Lock()
		if res.Log == "" {
			res.Log = j.log.String()
		}
		j.result, j.done = res, true
		j.mu.Unlock()
	}()
	return id
}

func getJob(id string) *job {
	jobsMu.Lock()
	defer jobsMu.Unlock()
	return jobs[id]
}
