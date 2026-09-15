package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
)

func TestClearAccessLogAtTruncatesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "access.log")
	if err := os.WriteFile(path, []byte("keep-me-not\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := clearAccessLogAt(path); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("cleared log still has %d bytes", len(got))
	}
	if err := clearAccessLogAt("none"); err != nil {
		t.Fatal(err)
	}
}

func TestPickExtensionInboundPrefersRemarkAndPort(t *testing.T) {
	rows := []model.Inbound{
		{Id: 1, Remark: "other", Port: 2053, Tag: "in-2053"},
		{Id: 2, Remark: "extension", Port: 443, Tag: "in-ext"},
		{Id: 3, Remark: "extension", Port: 2053, Tag: "in-ext-2053"},
	}
	got := pickExtensionInbound(rows)
	if got == nil || got.Id != 3 {
		t.Fatalf("pick = %#v, want id 3", got)
	}
}

func TestPickExtensionInboundFallsBackToRemark(t *testing.T) {
	rows := []model.Inbound{
		{Id: 1, Remark: "Extension", Port: 8443, Tag: "in-ext"},
	}
	got := pickExtensionInbound(rows)
	if got == nil || got.Id != 1 {
		t.Fatalf("pick = %#v, want remark match", got)
	}
}

func TestParseExtensionAccessLineHTTPProxySlashDest(t *testing.T) {
	line := "2026/09/15 00:42:43.279538 from 91.133.220.81:14762 accepted //www.youtube.com:443 [in-2053-tcp >> direct]"
	entry := parseExtensionAccessLine(line)
	if entry.DestHost != "www.youtube.com" || entry.DestPort != "443" || entry.URL != "https://www.youtube.com" {
		t.Fatalf("dest=%q port=%q url=%q", entry.DestHost, entry.DestPort, entry.URL)
	}
	if entry.Inbound != "in-2053-tcp" || entry.ClientIP != "91.133.220.81" {
		t.Fatalf("inbound=%q ip=%q", entry.Inbound, entry.ClientIP)
	}
	if entry.User != "91.133.220.81" {
		t.Fatalf("user=%q, want client IP when access log has no email", entry.User)
	}
	inbound := &model.Inbound{Remark: "Extension", Port: 2053, Tag: "in-2053-tcp"}
	if !lineMatchesExtensionInbound(line, entry, inbound) {
		t.Fatal("tag in-2053-tcp must match")
	}
}

func TestParseDestTargetHTTPAndHTTPS(t *testing.T) {
	netw, host, port, destURL := parseDestTarget("tcp:example.com:443")
	if netw != "tcp" || host != "example.com" || port != "443" || destURL != "https://example.com" {
		t.Fatalf("https dest = %s %s %s %s", netw, host, port, destURL)
	}
	netw, host, port, destURL = parseDestTarget("tcp:cdn.example.net:80")
	if netw != "tcp" || host != "cdn.example.net" || port != "80" || destURL != "http://cdn.example.net" {
		t.Fatalf("http dest = %s %s %s %s", netw, host, port, destURL)
	}
	netw, host, port, destURL = parseDestTarget("udp:8.8.8.8:53")
	if netw != "udp" || host != "8.8.8.8" || port != "53" || destURL != "udp://8.8.8.8:53" {
		t.Fatalf("udp dest = %s %s %s %s", netw, host, port, destURL)
	}
}

func TestParseExtensionAccessLineRejected(t *testing.T) {
	line := "2024/01/02 15:04:05.123456 from 1.2.3.4:555 rejected tcp:evil.example:443 [inbound-2053 >> blocked] email: bob@example.com"
	entry := parseExtensionAccessLine(line)
	if entry.Status != "rejected" {
		t.Fatalf("status = %q, want rejected", entry.Status)
	}
	if entry.DestHost != "evil.example" || entry.URL != "https://evil.example" {
		t.Fatalf("dest = %q url = %q", entry.DestHost, entry.URL)
	}
	if entry.ClientIP != "1.2.3.4" || entry.Email != "bob@example.com" {
		t.Fatalf("client = %q email = %q", entry.ClientIP, entry.Email)
	}
	if entry.Packet != "tcp:evil.example:443" {
		t.Fatalf("packet = %q", entry.Packet)
	}
}

func TestLineMatchesExtensionInboundByTag(t *testing.T) {
	inbound := &model.Inbound{Remark: "extension", Port: 2053, Tag: "inbound-2053"}
	line := "2024/01/02 15:04:05.123456 from 1.2.3.4:555 accepted tcp:example.com:443 [inbound-2053 >> direct] email: alice@example.com"
	entry := parseExtensionAccessLine(line)
	if !lineMatchesExtensionInbound(line, entry, inbound) {
		t.Fatal("expected tag match")
	}
	other := parseExtensionAccessLine("2024/01/02 15:04:05.123456 from 1.2.3.4:555 accepted tcp:example.com:443 [inbound-443 >> direct] email: alice@example.com")
	if lineMatchesExtensionInbound("x", other, inbound) {
		t.Fatal("other inbound must not match")
	}
}

func TestBuildMonitorClientsFromClientIPs(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	entries := []ExtensionLogEntry{
		{
			Time:     now.Add(-30 * time.Second).Format(time.RFC3339Nano),
			ClientIP: "192.0.2.10",
			DestHost: "youtube.com",
			DestPort: "443",
			URL:      "https://youtube.com",
		},
		{
			Time:     now.Add(-10 * time.Second).Format(time.RFC3339Nano),
			ClientIP: "192.0.2.10",
			DestHost: "fonts.gstatic.com",
			DestPort: "443",
			URL:      "https://fonts.gstatic.com",
		},
		{
			Time:     now.Add(-10 * time.Minute).Format(time.RFC3339Nano),
			ClientIP: "198.51.100.7",
			DestHost: "example.com",
			DestPort: "443",
			URL:      "https://example.com",
		},
		{
			Time:     now.Add(-5 * time.Second).Format(time.RFC3339Nano),
			Email:    "alice@example.com",
			ClientIP: "203.0.113.9",
			DestHost: "news.example",
			DestPort: "443",
			URL:      "https://news.example",
		},
	}
	rows, online := buildMonitorClients(entries, nil, map[string]struct{}{"alice@example.com": {}}, now)
	if len(rows) != 3 {
		t.Fatalf("clients = %d, want 3", len(rows))
	}
	if online != 2 {
		t.Fatalf("online = %d, want 2 (fresh IP + named email)", online)
	}
	if rows[0].User != "alice@example.com" && rows[0].User != "192.0.2.10" {
		t.Fatalf("first row should be an online user, got %#v", rows[0])
	}
	var ipRow *ExtensionClientRow
	for i := range rows {
		if rows[i].User == "192.0.2.10" {
			ipRow = &rows[i]
		}
	}
	if ipRow == nil {
		t.Fatal("missing IP-identified client")
	}
	if !ipRow.Online || ipRow.Hits != 2 || ipRow.LastURL != "https://fonts.gstatic.com" {
		t.Fatalf("ip row = %#v", ipRow)
	}
	if len(ipRow.RecentDests) != 2 || ipRow.RecentDests[0] != "https://fonts.gstatic.com" {
		t.Fatalf("recent dests = %#v", ipRow.RecentDests)
	}
}

func TestClampExtensionCount(t *testing.T) {
	if clampExtensionCount("") != extensionMonitorDefault {
		t.Fatal("empty should default")
	}
	if clampExtensionCount("99999") != extensionMonitorMax {
		t.Fatal("over max should clamp")
	}
	if clampExtensionCount("50") != 50 {
		t.Fatal("valid count should pass")
	}
}
