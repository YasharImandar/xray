package service

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	"github.com/mhsanaei/3x-ui/v3/internal/xray"
)

const (
	extensionInboundRemark  = "extension"
	extensionInboundPort    = 2053
	extensionMonitorMax     = 2000
	extensionMonitorDefault = 400
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
	Raw         string `json:"raw" example:"2025/01/01 12:00:00.000000 from 192.0.2.10:54321 accepted tcp:example.com:443 [inbound-2053 >> direct] email: alice@example.com"`
}

// ExtensionClientRow is one client on the extension inbound plus last dest.
type ExtensionClientRow struct {
	Email      string `json:"email" example:"alice@example.com"`
	Enable     bool   `json:"enable" example:"true"`
	Online     bool   `json:"online" example:"true"`
	Up         int64  `json:"up" example:"1048576"`
	Down       int64  `json:"down" example:"4194304"`
	Total      int64  `json:"total" example:"10737418240"`
	LastOnline int64  `json:"lastOnline" example:"1735680000000"`
	LastDest   string `json:"lastDest" example:"example.com:443"`
	LastURL    string `json:"lastURL" example:"https://example.com"`
	Hits       int    `json:"hits" example:"12"`
}

// ExtensionMonitorStats is the live tally for the current log window.
type ExtensionMonitorStats struct {
	EventCount  int `json:"eventCount" example:"128"`
	UniqueDests int `json:"uniqueDests" example:"17"`
	UniqueUsers int `json:"uniqueUsers" example:"4"`
	Online      int `json:"online" example:"2"`
	Accepted    int `json:"accepted" example:"120"`
	Rejected    int `json:"rejected" example:"8"`
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
	return entry
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

	hits := map[string]int{}
	lastDest := map[string]string{}
	lastURL := map[string]string{}
	for _, entry := range entries {
		if entry.Email != "" {
			hits[entry.Email]++
			lastDest[entry.Email] = destLabel(entry)
			lastURL[entry.Email] = entry.URL
		}
	}
	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	out.Logs = entries
	dests := map[string]struct{}{}
	users := map[string]struct{}{}
	for _, entry := range entries {
		if entry.DestHost != "" {
			dests[strings.ToLower(entry.DestHost)+":"+entry.DestPort] = struct{}{}
		}
		if entry.Email != "" {
			users[entry.Email] = struct{}{}
		}
		if entry.Status == "rejected" {
			out.Stats.Rejected++
		} else {
			out.Stats.Accepted++
		}
	}
	out.Stats.EventCount = len(entries)
	out.Stats.UniqueDests = len(dests)
	out.Stats.UniqueUsers = len(users)

	clients := make([]ExtensionClientRow, 0, len(inbound.ClientStats))
	onlineCount := 0
	for _, st := range inbound.ClientStats {
		row := ExtensionClientRow{
			Email:      st.Email,
			Enable:     st.Enable,
			Up:         st.Up,
			Down:       st.Down,
			Total:      st.Total,
			LastOnline: st.LastOnline,
			LastDest:   lastDest[st.Email],
			LastURL:    lastURL[st.Email],
			Hits:       hits[st.Email],
		}
		if _, ok := onlines[st.Email]; ok {
			row.Online = true
			onlineCount++
		}
		clients = append(clients, row)
	}
	out.Clients = clients
	out.Stats.Online = onlineCount
	return out
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
