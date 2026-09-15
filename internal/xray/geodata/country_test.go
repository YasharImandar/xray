package geodata

import "testing"

func TestCountryIndexLooksUpISOAndSkipsPrivate(t *testing.T) {
	dir := t.TempDir()
	path := writeIPDB(t, dir, "geoip.dat",
		geoip("ir", "5.0.0.0/8"),
		geoip("us", "1.2.3.0/24", "2001:db8::/32"),
		geoip("private", "10.0.0.0/8"),
		geoip("cloudflare", "1.2.3.0/24"),
	)
	idx, err := LoadCountryIndex(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := idx.Lookup("5.61.10.2"); got != "ir" {
		t.Fatalf("ir lookup = %q", got)
	}
	if got := idx.Lookup("1.2.3.9"); got != "us" {
		t.Fatalf("us lookup = %q (provider lists must not win)", got)
	}
	if got := idx.Lookup("10.1.2.3"); got != "" {
		t.Fatalf("private = %q, want empty", got)
	}
	if got := idx.Lookup("2001:db8:1::1"); got != "us" {
		t.Fatalf("v6 = %q", got)
	}
	if CountryName("ir") != "Iran" {
		t.Fatalf("name ir = %q", CountryName("ir"))
	}
	if LookupCountryCode(path, "5.61.10.2") != "ir" {
		t.Fatal("cached lookup missed")
	}
	if LookupCountryCode(path, "5.61.10.2") != "ir" {
		t.Fatal("second cached lookup missed")
	}
}
