package geodata

import (
	"net/netip"
	"os"
	"sort"
	"strings"
	"sync"
	"unicode"
)

// CountryIndex maps an IP to an ISO 3166-1 alpha-2 country code using an
// Xray geoip.dat. Only two-letter country categories are kept so provider
// lists (cloudflare, telegram, private) do not hide the real country.
type CountryIndex struct {
	v4 []ip4Range
	v6 []ip6Range
}

type ip4Range struct {
	start, last uint32
	bits        uint8
	code        string
}

type ip6Range struct {
	start, last [16]byte
	bits        uint8
	code        string
}

type countryCache struct {
	mu    sync.Mutex
	idx   *CountryIndex
	path  string
	size  int64
	mtime int64
}

var defaultCountries countryCache

// LookupCountryCode returns the ISO country code for ip from path, or "".
func LookupCountryCode(path, ip string) string {
	idx := defaultCountries.load(path)
	if idx == nil {
		return ""
	}
	return idx.Lookup(ip)
}

func (c *countryCache) load(path string) *CountryIndex {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > MaxFileSize {
		return nil
	}
	size, mtime := info.Size(), info.ModTime().UnixNano()

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.idx != nil && c.path == path && c.size == size && c.mtime == mtime {
		return c.idx
	}
	idx, err := LoadCountryIndex(path)
	if err != nil {
		return nil
	}
	c.idx, c.path, c.size, c.mtime = idx, path, size, mtime
	return idx
}

// LoadCountryIndex parses a geoip.dat into an in-memory country CIDR index.
func LoadCountryIndex(path string) (*CountryIndex, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > MaxFileSize {
		return nil, ErrFileTooLarge
	}
	idx := &CountryIndex{}
	err = eachListEntry(data, func(entry []byte, _ byteSpan) error {
		code, werr := walkEntry(entry, nil)
		if werr != nil || !isISOCountryCode(code) {
			return werr
		}
		_, err := walkEntry(entry, func(payload []byte) error {
			prefix, ok, perr := parseCIDRPrefix(payload)
			if perr != nil || !ok {
				return perr
			}
			idx.add(code, prefix)
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(idx.v4, func(i, j int) bool { return idx.v4[i].bits > idx.v4[j].bits })
	sort.SliceStable(idx.v6, func(i, j int) bool { return idx.v6[i].bits > idx.v6[j].bits })
	return idx, nil
}

func (idx *CountryIndex) add(code string, prefix netip.Prefix) {
	addr := prefix.Addr()
	if addr.Is4() {
		start := ipv4Uint(addr)
		idx.v4 = append(idx.v4, ip4Range{
			start: start,
			last:  start | ipv4Mask(prefix.Bits()),
			bits:  uint8(prefix.Bits()),
			code:  code,
		})
		return
	}
	if addr.Is6() {
		start := addr.As16()
		idx.v6 = append(idx.v6, ip6Range{
			start: start,
			last:  ipv6Last(start, prefix.Bits()),
			bits:  uint8(prefix.Bits()),
			code:  code,
		})
	}
}

// Lookup returns the lowercase ISO country code for ip, or "".
func (idx *CountryIndex) Lookup(ip string) string {
	if idx == nil {
		return ""
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(ip))
	if err != nil {
		return ""
	}
	if addr.Is4() {
		u := ipv4Uint(addr)
		for _, r := range idx.v4 {
			if u >= r.start && u <= r.last {
				return r.code
			}
		}
		return ""
	}
	if addr.Is6() {
		raw := addr.As16()
		for _, r := range idx.v6 {
			if bytesCmp(r.start, raw) <= 0 && bytesCmp(raw, r.last) <= 0 {
				return r.code
			}
		}
	}
	return ""
}

func isISOCountryCode(code string) bool {
	if len(code) != 2 {
		return false
	}
	for _, r := range code {
		if !unicode.IsLetter(r) {
			return false
		}
	}
	return true
}

func ipv4Uint(addr netip.Addr) uint32 {
	a := addr.As4()
	return uint32(a[0])<<24 | uint32(a[1])<<16 | uint32(a[2])<<8 | uint32(a[3])
}

func ipv4Mask(bits int) uint32 {
	if bits <= 0 {
		return 0xffffffff
	}
	if bits >= 32 {
		return 0
	}
	return 1<<(32-bits) - 1
}

func ipv6Last(start [16]byte, bits int) [16]byte {
	last := start
	if bits <= 0 {
		for i := range last {
			last[i] = 0xff
		}
		return last
	}
	if bits >= 128 {
		return last
	}
	host := 128 - bits
	for i := 15; i >= 0 && host > 0; i-- {
		n := host
		if n > 8 {
			n = 8
		}
		last[i] |= byte(1<<n - 1)
		host -= n
	}
	return last
}

func bytesCmp(a, b [16]byte) int {
	for i := range a {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}

func parseCIDRPrefix(payload []byte) (netip.Prefix, bool, error) {
	raw, ok, err := cidrBytes(payload)
	if err != nil || !ok {
		return netip.Prefix{}, ok, err
	}
	prefix, perr := netip.ParsePrefix(string(raw))
	if perr != nil {
		return netip.Prefix{}, false, nil
	}
	return prefix, true, nil
}
