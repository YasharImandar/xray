package service

import (
	"bufio"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/xray"
	"github.com/mhsanaei/3x-ui/v3/internal/xray/geodata"
)

const (
	extensionInboundRemark  = "extension"
	extensionInboundPort    = 2053
	extensionMonitorMax     = 2000
	extensionMonitorDefault = 400
	extensionOnlineWindow   = 2 * time.Minute
	extensionRecentDests    = 8
)

// ExtensionInboundInfo is the panel inbound this monitor is pinned to.
type ExtensionInboundInfo struct {
	Id       int    `json:"id" example:"1"`
	Remark   string `json:"remark" example:"extension"`
	Tag      string `json:"tag" example:"inbound-2053"`
	Protocol string `json:"protocol" example:"vless"`
	Port     int    `json:"port" example:"2053"`
	Enable   bool   `json:"enable" example:"true"`
	Up       int64  `json:"up" example:"1048576"`
	Down     int64  `json:"down" example:"4194304"`
	Clients  int    `json:"clients" example:"3"`
}

// ExtensionLogEntry is one access-log event from the extension inbound.
type ExtensionLogEntry struct {
	Time        string `json:"time" example:"2025-01-01T12:00:00Z"`
	Email       string `json:"email" example:"alice@example.com"`
	ClientIP    string `json:"clientIp" example:"192.0.2.10"`
	ClientPort  string `json:"clientPort" example:"54321"`
	Network     string `json:"network" example:"tcp"`
	DestHost    string `json:"destHost" example:"example.com"`
	DestPort    string `json:"destPort" example:"443"`
	DestAddress string `json:"destAddress" example:"tcp:example.com:443"`
	URL         string `json:"url" example:"https://example.com"`
	Packet      string `json:"packet" example:"tcp:example.com:443"`
	Inbound     string `json:"inbound" example:"inbound-2053"`
	Outbound    string `json:"outbound" example:"direct"`
	Status      string `json:"status" example:"accepted"`
	Event       string `json:"event" example:"direct"`
	EventCode   int    `json:"eventCode" example:"0"`
	User        string `json:"user" example:"alice@example.com"`
	Country     string `json:"country" example:"Iran"`
	CountryCode string `json:"countryCode" example:"IR"`
	Raw         string `json:"raw" example:"2025/01/01 12:00:00.000000 from 192.0.2.10:54321 accepted tcp:example.com:443 [inbound-2053 >> direct] email: alice@example.com"`
}

// ExtensionClientRow is one client on the extension inbound plus last dest.
type ExtensionClientRow struct {
	Email       string   `json:"email" example:"alice@example.com"`
	Enable      bool     `json:"enable" example:"true"`
	Online      bool     `json:"online" example:"true"`
	Up          int64    `json:"up" example:"1048576"`
	Down        int64    `json:"down" example:"4194304"`
	Total       int64    `json:"total" example:"10737418240"`
	LastOnline  int64    `json:"lastOnline" example:"1735680000000"`
	LastDest    string   `json:"lastDest" example:"example.com:443"`
	LastURL     string   `json:"lastURL" example:"https://example.com"`
	RecentDests []string `json:"recentDests" example:"[\"https://example.com\"]"`
	User        string   `json:"user" example:"192.0.2.10"`
	ClientIP    string   `json:"clientIp" example:"192.0.2.10"`
	Country     string   `json:"country" example:"Iran"`
	CountryCode string   `json:"countryCode" example:"IR"`
	Hits        int      `json:"hits" example:"12"`
}

// ExtensionMonitorStats tallies the whole access log, not the page of lines
// Logs carries: the log holds far more events than any UI table shows, and a
// count that silently equalled the display limit read as a broken counter.
type ExtensionMonitorStats struct {
	EventCount  int `json:"eventCount" example:"107711"`
	UniqueDests int `json:"uniqueDests" example:"108"`
	UniqueIps   int `json:"uniqueIps" example:"319"`
	Online      int `json:"online" example:"2"`
	Accepted    int `json:"accepted" example:"107700"`
	Rejected    int `json:"rejected" example:"11"`
	// LogCount is how many of those events Logs actually carries.
	LogCount int `json:"logCount" example:"400"`
}

// ExtensionMonitorSnapshot is the Monitoring page payload for inbound extension.
type ExtensionMonitorSnapshot struct {
	Found            bool                  `json:"found" example:"true"`
	AccessLogEnabled bool                  `json:"accessLogEnabled" example:"true"`
	AccessLogPath    string                `json:"accessLogPath" example:"/var/log/x-ui/access.log"`
	Inbound          *ExtensionInboundInfo `json:"inbound"`
	Logs             []ExtensionLogEntry   `json:"logs"`
	Clients          []ExtensionClientRow  `json:"clients"`
	Stats            ExtensionMonitorStats `json:"stats"`
}

func pickExtensionInbound(rows []model.Inbound) *model.Inbound {
	var byBoth, byRemark, byPort *model.Inbound
	for i := range rows {
		row := &rows[i]
		remarkMatch := strings.EqualFold(strings.TrimSpace(row.Remark), extensionInboundRemark)
		portMatch := row.Port == extensionInboundPort
		switch {
		case remarkMatch && portMatch:
			byBoth = row
		case remarkMatch && byRemark == nil:
			byRemark = row
		case portMatch && byPort == nil:
			byPort = row
		}
	}
	if byBoth != nil {
		return byBoth
	}
	if byRemark != nil {
		return byRemark
	}
	return byPort
}

func splitDestHostPort(rest string) (host, port string) {
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return "", ""
	}
	if strings.HasPrefix(rest, "[") {
		end := strings.Index(rest, "]")
		if end > 1 {
			host = rest[1:end]
			return host, strings.TrimPrefix(rest[end+1:], ":")
		}
	}
	if strings.Count(rest, ":") > 1 {
		return rest, ""
	}
	i := strings.LastIndex(rest, ":")
	if i <= 0 {
		return rest, ""
	}
	return rest[:i], rest[i+1:]
}

func inferDestURL(network, host, port string) string {
	if host == "" {
		return ""
	}
	switch port {
	case "443":
		return "https://" + host
	case "80":
		return "http://" + host
	}
	if network == "udp" {
		if port != "" {
			return "udp://" + host + ":" + port
		}
		return "udp://" + host
	}
	if port != "" {
		return host + ":" + port
	}
	return host
}

func parseDestTarget(to string) (network, host, port, destURL string) {
	to = strings.TrimSpace(strings.TrimLeft(to, "/"))
	if to == "" {
		return "", "", "", ""
	}
	rest := to
	if i := strings.Index(to, ":"); i > 0 {
		proto := strings.ToLower(to[:i])
		if proto == "tcp" || proto == "udp" {
			network = proto
			rest = to[i+1:]
		}
	}
	host, port = splitDestHostPort(rest)
	return network, host, port, inferDestURL(network, host, port)
}

func splitHostPort(addr string) (host, port string) {
	addr = strings.TrimSpace(strings.TrimLeft(addr, "/"))
	if addr == "" {
		return "", ""
	}
	if i := strings.Index(addr, "://"); i >= 0 {
		addr = addr[i+3:]
	}
	return splitDestHostPort(addr)
}

func parseExtensionAccessLine(line string) ExtensionLogEntry {
	base := parseAccessLogFields(line)
	status := "accepted"
	if strings.Contains(line, " rejected ") {
		status = "rejected"
	}
	if base.ToAddress == "" {
		parts := strings.Fields(line)
		for i, part := range parts {
			if (part == "accepted" || part == "rejected") && i+1 < len(parts) {
				base.ToAddress = strings.TrimLeft(parts[i+1], "/")
				break
			}
		}
	}
	network, destHost, destPort, destURL := parseDestTarget(base.ToAddress)
	clientIP, clientPort := splitHostPort(base.FromAddress)
	packet := strings.TrimSpace(base.ToAddress)
	if packet == "" {
		packet = destURL
	}
	entry := ExtensionLogEntry{
		Email:       base.Email,
		ClientIP:    clientIP,
		ClientPort:  clientPort,
		Network:     network,
		DestHost:    destHost,
		DestPort:    destPort,
		DestAddress: base.ToAddress,
		URL:         destURL,
		Packet:      packet,
		Inbound:     base.Inbound,
		Outbound:    base.Outbound,
		Status:      status,
		Raw:         line,
	}
	if !base.DateTime.IsZero() {
		entry.Time = base.DateTime.UTC().Format(time.RFC3339Nano)
	}
	entry.User = monitorUserKey(entry)
	return entry
}

func monitorUserKey(entry ExtensionLogEntry) string {
	if email := strings.TrimSpace(entry.Email); email != "" {
		return email
	}
	return strings.TrimSpace(entry.ClientIP)
}

func lineMatchesExtensionInbound(line string, entry ExtensionLogEntry, inbound *model.Inbound) bool {
	if inbound == nil {
		return false
	}
	tag := strings.TrimSpace(inbound.Tag)
	ib := strings.TrimSpace(entry.Inbound)
	if tag != "" && strings.EqualFold(ib, tag) {
		return true
	}
	if tag != "" && (strings.Contains(line, "["+tag+" ") || strings.Contains(line, "["+tag+"]")) {
		return true
	}
	if strings.Contains(strings.ToLower(ib), extensionInboundRemark) {
		return true
	}
	return inbound.Port == extensionInboundPort && strings.Contains(ib, strconv.Itoa(extensionInboundPort))
}

func classifyExtensionEvent(line string, freedoms, blackholes []string) (string, int) {
	const (
		direct = iota
		blocked
		proxied
	)
	switch {
	case logEntryContains(line, freedoms):
		return "direct", direct
	case logEntryContains(line, blackholes):
		return "blocked", blocked
	default:
		return "proxy", proxied
	}
}

func clampExtensionCount(count string) int {
	n, err := strconv.Atoi(strings.TrimSpace(count))
	if err != nil || n < 1 {
		return extensionMonitorDefault
	}
	if n > extensionMonitorMax {
		return extensionMonitorMax
	}
	return n
}

func loadExtensionInbound() (*model.Inbound, error) {
	var rows []model.Inbound
	err := database.GetDB().
		Preload("ClientStats").
		Where("node_id IS NULL AND (LOWER(remark) = ? OR port = ?)", extensionInboundRemark, extensionInboundPort).
		Order("id ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return pickExtensionInbound(rows), nil
}

func accessLogDisabled(path string) bool {
	p := strings.TrimSpace(path)
	return p == "" || p == "none" || p == "stdout" || p == "stderr"
}

func clearAccessLogAt(path string) error {
	if accessLogDisabled(path) {
		return nil
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Truncate(0)
}

// ClearAccessLog empties the Xray access log the Monitoring page reads.
func (s *ServerService) ClearAccessLog() error {
	path, err := xray.GetAccessLogPath()
	if err != nil {
		return err
	}
	return clearAccessLogAt(path)
}

// GetExtensionMonitor returns live access-log traffic for inbound remark
// "extension" or port 2053, plus that inbound's clients and a window tally.
func (s *ServerService) GetExtensionMonitor(count string, filter string) *ExtensionMonitorSnapshot {
	out := &ExtensionMonitorSnapshot{
		Logs:    []ExtensionLogEntry{},
		Clients: []ExtensionClientRow{},
	}
	enabled, err := s.settingService.GetAccessLogEnable()
	if err == nil {
		out.AccessLogEnabled = enabled
	}
	path, err := xray.GetAccessLogPath()
	if err == nil {
		out.AccessLogPath = path
	}

	inbound, err := loadExtensionInbound()
	if err != nil || inbound == nil {
		return out
	}
	out.Found = true
	out.Inbound = &ExtensionInboundInfo{
		Id:       inbound.Id,
		Remark:   inbound.Remark,
		Tag:      inbound.Tag,
		Protocol: string(inbound.Protocol),
		Port:     inbound.Port,
		Enable:   inbound.Enable,
		Up:       inbound.Up,
		Down:     inbound.Down,
		Clients:  len(inbound.ClientStats),
	}

	onlines := map[string]struct{}{}
	for _, email := range s.inboundService.GetOnlineClients() {
		onlines[email] = struct{}{}
	}

	limit := clampExtensionCount(count)
	needle := strings.ToLower(strings.TrimSpace(filter))
	freedoms, blackholes := s.GetDefaultLogOutboundTags()

	var entries []ExtensionLogEntry
	if path != "" && path != "none" && path != "stdout" && path != "stderr" {
		entries = readExtensionAccessLog(path, inbound, needle, freedoms, blackholes)
	}

	clients, onlineCount := buildMonitorClients(entries, inbound.ClientStats, onlines, time.Now())
	fillMonitorStats(out, entries, clients, onlineCount, limit)
	applyMonitorCountriesAt(out, xray.GetGeoipPath())
	return out
}

// fillMonitorStats tallies every parsed event, then trims Logs to the newest
// limit lines. The tally deliberately runs before the trim: the access log
// holds orders of magnitude more events than the table shows, so counting the
// page made Events and Accepted sit permanently at the display limit.
func fillMonitorStats(out *ExtensionMonitorSnapshot, entries []ExtensionLogEntry, clients []ExtensionClientRow, onlineCount, limit int) {
	dests := map[string]struct{}{}
	for _, entry := range entries {
		if entry.DestHost != "" {
			dests[strings.ToLower(entry.DestHost)+":"+entry.DestPort] = struct{}{}
		}
		if entry.Status == "rejected" {
			out.Stats.Rejected++
		} else {
			out.Stats.Accepted++
		}
	}
	out.Stats.EventCount = len(entries)
	out.Stats.UniqueDests = len(dests)
	out.Stats.UniqueIps = len(clients)
	out.Stats.Online = onlineCount

	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	out.Logs = entries
	out.Stats.LogCount = len(entries)
	out.Clients = clients
	if out.Inbound != nil {
		out.Inbound.Clients = len(clients)
	}
}

func applyMonitorCountriesAt(out *ExtensionMonitorSnapshot, geoipPath string) {
	if out == nil {
		return
	}
	cache := map[string][2]string{}
	lookup := func(ip string) (country, code string) {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			return "", ""
		}
		if hit, ok := cache[ip]; ok {
			return hit[0], hit[1]
		}
		raw := geodata.LookupCountryCode(geoipPath, ip)
		if raw == "" {
			cache[ip] = [2]string{}
			return "", ""
		}
		country, code = geodata.CountryName(raw), strings.ToUpper(raw)
		cache[ip] = [2]string{country, code}
		return country, code
	}
	for i := range out.Clients {
		out.Clients[i].Country, out.Clients[i].CountryCode = lookup(out.Clients[i].ClientIP)
	}
	for i := range out.Logs {
		out.Logs[i].Country, out.Logs[i].CountryCode = lookup(out.Logs[i].ClientIP)
	}
}

func destLabel(entry ExtensionLogEntry) string {
	if entry.DestHost == "" {
		return entry.DestAddress
	}
	if entry.DestPort != "" {
		return entry.DestHost + ":" + entry.DestPort
	}
	return entry.DestHost
}

func entryTime(entry ExtensionLogEntry) time.Time {
	if entry.Time == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, entry.Time); err == nil {
		return t
	}
	t, _ := time.Parse(time.RFC3339, entry.Time)
	return t
}

func destPref(entry ExtensionLogEntry) string {
	if u := strings.TrimSpace(entry.URL); u != "" {
		return u
	}
	return destLabel(entry)
}

func pushRecentDest(list []string, item string) []string {
	item = strings.TrimSpace(item)
	if item == "" {
		return list
	}
	next := make([]string, 0, len(list)+1)
	for _, existing := range list {
		if !strings.EqualFold(existing, item) {
			next = append(next, existing)
		}
	}
	next = append(next, item)
	if len(next) > extensionRecentDests {
		return next[len(next)-extensionRecentDests:]
	}
	return next
}

func reverseStrings(in []string) []string {
	out := make([]string, len(in))
	for i, v := range in {
		out[len(in)-1-i] = v
	}
	return out
}

type monitorUserAgg struct {
	key      string
	email    string
	clientIP string
	hits     int
	lastDest string
	lastURL  string
	lastSeen time.Time
	dests    []string
	enable   bool
	up       int64
	down     int64
	total    int64
}

func buildMonitorClients(entries []ExtensionLogEntry, stats []xray.ClientTraffic, onlines map[string]struct{}, now time.Time) ([]ExtensionClientRow, int) {
	aggs := map[string]*monitorUserAgg{}
	order := make([]string, 0)
	for _, entry := range entries {
		key := monitorUserKey(entry)
		if key == "" {
			continue
		}
		agg, ok := aggs[key]
		if !ok {
			agg = &monitorUserAgg{key: key, enable: true}
			aggs[key] = agg
			order = append(order, key)
		}
		agg.hits++
		if email := strings.TrimSpace(entry.Email); email != "" {
			agg.email = email
		}
		if ip := strings.TrimSpace(entry.ClientIP); ip != "" {
			agg.clientIP = ip
		}
		agg.lastDest = destLabel(entry)
		agg.lastURL = entry.URL
		agg.dests = pushRecentDest(agg.dests, destPref(entry))
		if ts := entryTime(entry); !ts.IsZero() {
			agg.lastSeen = ts
		}
	}
	for _, st := range stats {
		email := strings.TrimSpace(st.Email)
		if email == "" {
			continue
		}
		agg, ok := aggs[email]
		if !ok {
			agg = &monitorUserAgg{key: email, email: email, enable: st.Enable}
			aggs[email] = agg
			order = append(order, email)
		}
		agg.email = email
		agg.enable = st.Enable
		agg.up = st.Up
		agg.down = st.Down
		agg.total = st.Total
		if st.LastOnline > 0 {
			stSeen := time.UnixMilli(st.LastOnline)
			if agg.lastSeen.IsZero() || stSeen.After(agg.lastSeen) {
				agg.lastSeen = stSeen
			}
		}
	}

	rows := make([]ExtensionClientRow, 0, len(order))
	onlineCount := 0
	for _, key := range order {
		agg := aggs[key]
		row := ExtensionClientRow{
			Email:       agg.email,
			User:        key,
			ClientIP:    agg.clientIP,
			Enable:      agg.enable,
			Up:          agg.up,
			Down:        agg.down,
			Total:       agg.total,
			LastDest:    agg.lastDest,
			LastURL:     agg.lastURL,
			RecentDests: reverseStrings(agg.dests),
			Hits:        agg.hits,
		}
		if row.Email == "" {
			row.Email = key
		}
		if !agg.lastSeen.IsZero() {
			row.LastOnline = agg.lastSeen.UnixMilli()
		}
		_, namedOnline := onlines[agg.email]
		if namedOnline || (!agg.lastSeen.IsZero() && now.Sub(agg.lastSeen) <= extensionOnlineWindow) {
			row.Online = true
			onlineCount++
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.Online != b.Online {
			return a.Online
		}
		if a.LastOnline != b.LastOnline {
			return a.LastOnline > b.LastOnline
		}
		return a.User < b.User
	})
	return rows, onlineCount
}

func readExtensionAccessLog(path string, inbound *model.Inbound, needle string, freedoms, blackholes []string) []ExtensionLogEntry {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	var entries []ExtensionLogEntry
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.Contains(line, "api -> api") {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(line), needle) {
			continue
		}
		entry := parseExtensionAccessLine(line)
		if !lineMatchesExtensionInbound(line, entry, inbound) {
			continue
		}
		entry.Event, entry.EventCode = classifyExtensionEvent(line, freedoms, blackholes)
		entries = append(entries, entry)
	}
	return entries
}
