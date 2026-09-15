package service

import (
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	xraygeodata "github.com/xtls/xray-core/common/geodata"
	"google.golang.org/protobuf/proto"
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
	scan := newExtensionScan(100)
	for _, entry := range entries {
		scan.add(entry)
	}
	rows, online := scan.clientRows(nil, map[string]struct{}{"alice@example.com": {}}, now)
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
	if ipRow.Email != "" {
		t.Fatalf("email = %q, want empty so the UI can drop the duplicate User column", ipRow.Email)
	}
	if len(ipRow.RecentDests) != 2 || ipRow.RecentDests[0] != "https://fonts.gstatic.com" {
		t.Fatalf("recent dests = %#v", ipRow.RecentDests)
	}
}

func TestMonitorStatsCountWholeLogNotTheDisplayedPage(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "access.log")
	var b strings.Builder
	for i := range 50 {
		fmt.Fprintf(&b,
			"2026/09/15 00:%02d:%02d.000000 from 10.0.%d.%d:1000 accepted //host%d.example:443 [in-2053-tcp >> direct]\n",
			i/60, i%60, i/256, i%256, i)
	}
	if err := os.WriteFile(logPath, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	inbound := &model.Inbound{Remark: "Extension", Port: 2053, Tag: "in-2053-tcp"}
	scan := scanExtensionAccessLog(logPath, inbound, "", nil, nil, 10)
	if scan.total != 50 {
		t.Fatalf("parsed %d lines, want 50", scan.total)
	}

	out := &ExtensionMonitorSnapshot{Inbound: &ExtensionInboundInfo{}}
	clients, _ := scan.clientRows(nil, nil, time.Now())
	fillMonitorStats(out, scan, clients, 0)

	if out.Stats.EventCount != 50 {
		t.Fatalf("eventCount = %d, want the whole log (50), not the page", out.Stats.EventCount)
	}
	if out.Stats.Accepted != 50 {
		t.Fatalf("accepted = %d, want 50", out.Stats.Accepted)
	}
	if out.Stats.UniqueDests != 50 || out.Stats.UniqueIps != 50 {
		t.Fatalf("dests = %d, ips = %d, want 50 each", out.Stats.UniqueDests, out.Stats.UniqueIps)
	}
	if len(out.Logs) != 10 || out.Stats.LogCount != 10 {
		t.Fatalf("logs = %d, logCount = %d, want the 10-line page", len(out.Logs), out.Stats.LogCount)
	}
	if out.Logs[len(out.Logs)-1].DestHost != "host49.example" {
		t.Fatalf("page must keep the newest lines, got %q", out.Logs[len(out.Logs)-1].DestHost)
	}
	if out.Logs[0].DestHost != "host40.example" {
		t.Fatalf("page must start at the 10th-newest line, got %q", out.Logs[0].DestHost)
	}
}

func TestEntryRingKeepsOnlyTheNewestLines(t *testing.T) {
	ring := entryRing{buf: make([]ExtensionLogEntry, 0, 3)}
	for _, host := range []string{"a", "b", "c", "d", "e"} {
		ring.push(ExtensionLogEntry{DestHost: host})
	}
	got := make([]string, 0, 3)
	for _, entry := range ring.ordered() {
		got = append(got, entry.DestHost)
	}
	if strings.Join(got, ",") != "c,d,e" {
		t.Fatalf("ring = %v, want the newest three in order", got)
	}

	// A zero-capacity ring is what a caller asking for no log lines gets.
	empty := entryRing{buf: make([]ExtensionLogEntry, 0, 0)}
	empty.push(ExtensionLogEntry{DestHost: "a"})
	if len(empty.ordered()) != 0 {
		t.Fatal("zero-capacity ring must stay empty")
	}
}

func TestTopDestsRanksByHitsAndCountsClients(t *testing.T) {
	scan := newExtensionScan(10)
	add := func(ip, host string, rejected bool) {
		entry := ExtensionLogEntry{
			Time:     "2026-09-15T12:00:00Z",
			ClientIP: ip,
			DestHost: host,
			DestPort: "443",
			URL:      "https://" + host,
		}
		if rejected {
			entry.Status = "rejected"
		}
		scan.add(entry)
	}
	add("1.1.1.1", "youtube.com", false)
	add("2.2.2.2", "youtube.com", false)
	add("1.1.1.1", "youtube.com", false)
	add("3.3.3.3", "ads.example", true)

	rows := scan.topDests(5)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0].Host != "youtube.com" || rows[0].Hits != 3 || rows[0].Clients != 2 {
		t.Fatalf("top row = %#v", rows[0])
	}
	if rows[0].URL != "https://youtube.com" || rows[0].LastSeen == 0 {
		t.Fatalf("top row lost url/lastSeen: %#v", rows[0])
	}
	if rows[1].Host != "ads.example" || rows[1].Rejected != 1 {
		t.Fatalf("rejected row = %#v", rows[1])
	}
	if got := scan.topDests(1); len(got) != 1 {
		t.Fatalf("cap ignored, got %d rows", len(got))
	}
}

func TestTimelineDownsamplesToRequestedPoints(t *testing.T) {
	scan := newExtensionScan(1)
	start := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
	// Ten hours of one event per minute: far more minutes than chart points.
	for i := range 600 {
		scan.add(ExtensionLogEntry{Time: start.Add(time.Duration(i) * time.Minute).Format(time.RFC3339Nano)})
	}
	buckets := scan.timeline(60)
	if len(buckets) != 60 {
		t.Fatalf("buckets = %d, want 60", len(buckets))
	}
	total := 0
	for _, bucket := range buckets {
		total += bucket.Events
	}
	if total != 600 {
		t.Fatalf("timeline total = %d, want every event counted once", total)
	}
	if buckets[0].At != start.UnixMilli() {
		t.Fatalf("first bucket at %d, want the first minute %d", buckets[0].At, start.UnixMilli())
	}
	if buckets[1].At-buckets[0].At != 10*60_000 {
		t.Fatalf("bucket width = %dms, want 10 minutes", buckets[1].At-buckets[0].At)
	}
	if len(newExtensionScan(1).timeline(60)) != 0 {
		t.Fatal("an empty log must yield an empty timeline")
	}
}

func TestMonitorCountryRowsGroupClientsAndCap(t *testing.T) {
	clients := []ExtensionClientRow{
		{CountryCode: "IR", Country: "Iran", Hits: 10},
		{CountryCode: "IR", Country: "Iran", Hits: 5},
		{CountryCode: "US", Country: "United States", Hits: 100},
		{CountryCode: "", Country: "", Hits: 7},
	}
	rows := monitorCountryRows(clients, 5)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2 (unknown country dropped)", len(rows))
	}
	if rows[0].Code != "IR" || rows[0].Clients != 2 || rows[0].Hits != 15 {
		t.Fatalf("first row = %#v, want IR ranked by client count", rows[0])
	}
	if rows[1].Code != "US" || rows[1].Clients != 1 {
		t.Fatalf("second row = %#v", rows[1])
	}
	if got := monitorCountryRows(clients, 1); len(got) != 1 {
		t.Fatalf("cap ignored, got %d rows", len(got))
	}
}

func TestApplyMonitorCountriesAtSetsFlagFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "geoip.dat")
	prefix := netip.MustParsePrefix("5.0.0.0/8")
	data, err := proto.Marshal(&xraygeodata.GeoIPList{Entry: []*xraygeodata.GeoIP{{
		Code: "ir",
		Cidr: []*xraygeodata.CIDR{{Ip: prefix.Addr().AsSlice(), Prefix: uint32(prefix.Bits())}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	out := &ExtensionMonitorSnapshot{
		Clients: []ExtensionClientRow{{ClientIP: "5.61.10.2"}},
		Logs:    []ExtensionLogEntry{{ClientIP: "5.61.10.2"}},
	}
	applyMonitorCountriesAt(out, path)
	if out.Clients[0].Country != "Iran" || out.Clients[0].CountryCode != "IR" {
		t.Fatalf("client country = %#v", out.Clients[0])
	}
	if out.Logs[0].Country != "Iran" || out.Logs[0].CountryCode != "IR" {
		t.Fatalf("log country = %#v", out.Logs[0])
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
