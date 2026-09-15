// clipboard-agent watches the local OS clipboard and posts each new text value
// to the panel ingest endpoint. Stdlib only, so it cross-compiles with no cgo.
package main

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

type event struct {
	Host    string `json:"host"`
	Room    string `json:"room"`
	Ts      int64  `json:"ts"`
	Content string `json:"content"`
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	server := flag.String("server", envOr("CLIP_SERVER", ""), "ingest URL, e.g. https://panel.example/clip/ingest")
	token := flag.String("token", envOr("CLIP_TOKEN", ""), "bearer token the ingest endpoint expects")
	room := flag.String("room", envOr("CLIP_ROOM", ""), "room/PC label carried with each event")
	interval := flag.Duration("interval", 1500*time.Millisecond, "clipboard poll interval")
	maxBytes := flag.Int("max", 64*1024, "max content bytes sent per event")
	insecure := flag.Bool("insecure", false, "skip TLS verification (self-signed panel cert)")
	flag.Parse()

	if *server == "" {
		log.Fatal("clipboard-agent: -server (or CLIP_SERVER) is required")
	}

	host, _ := os.Hostname()
	client := &http.Client{Timeout: 10 * time.Second}
	if *insecure {
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	}
	log.Printf("clipboard-agent: host=%q room=%q server=%q interval=%s", host, *room, *server, *interval)

	last := ""
	for {
		text, err := readClipboard()
		switch {
		case err != nil:
			log.Printf("read clipboard: %v", err)
		case text != "" && text != last:
			last = text
			body := text
			if len(body) > *maxBytes {
				body = body[:*maxBytes]
			}
			if err := send(client, *server, *token, event{
				Host:    host,
				Room:    *room,
				Ts:      time.Now().UnixMilli(),
				Content: body,
			}); err != nil {
				log.Printf("send: %v", err)
			}
		}
		time.Sleep(*interval)
	}
}

func send(client *http.Client, url, token string, ev event) error {
	payload, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ingest returned status %d", resp.StatusCode)
	}
	return nil
}
