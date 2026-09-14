package service

import (
	"testing"

	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
)

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
