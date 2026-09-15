# clipboard-agent

Small stdlib-only Go program that runs on each managed PC, watches the OS
clipboard, and POSTs every new text value to the panel ingest endpoint.

> **Responsibility:** the clipboard often holds passwords and 2FA codes. Only
> deploy on machines you own, tell users it is monitored, keep a short retention
> window, and lock down who can read the collected data.

## Key facts

- **Extension:** Windows `.exe`; macOS/Linux have no extension (plain executable, `chmod +x`).
- **Size:** ~6 MB per target, stripped (`-s -w -trimpath`). Optional UPX drops it to ~2 MB, but UPX-packed `.exe` can trip antivirus, so it is off by default.
- **Dependencies:** none on Windows/macOS. Linux needs one of `wl-clipboard`, `xclip`, or `xsel`.
- **Auto-run:** yes — see per-OS setup below. The clipboard is bound to the
  interactive desktop session, so the agent must run **in the logged-in user's
  session**, never as a Session-0 system service/daemon.

## Build

```bash
./build.sh          # writes dist/clipboard-agent-<os>-<arch>[.exe]
```

## Run

```bash
clipboard-agent -server https://panel.example/clip/ingest -token <TOKEN> -room otagh1
```

Flags (or env): `-server`/`CLIP_SERVER`, `-token`/`CLIP_TOKEN`, `-room`/`CLIP_ROOM`,
`-interval` (default 1.5s), `-max` (default 64 KB), `-insecure` (self-signed panel cert).

## Auto-run

### Windows (Task Scheduler, runs in the user session)

Copy the exe to `C:\ProgramData\clip\clipboard-agent.exe`, then:

```bat
schtasks /Create /TN "clip-agent" /SC ONLOGON /RL HIGHEST /F ^
  /TR "C:\ProgramData\clip\clipboard-agent.exe -server https://panel.example/clip/ingest -token TOKEN -room otagh1"
```

A Windows *service* (`sc create`) will NOT see the interactive clipboard — use the
logon task above (or a shortcut in `shell:startup`).

### macOS (per-user LaunchAgent)

`~/Library/LaunchAgents/clip.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>clip.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/clipboard-agent</string>
    <string>-server</string><string>https://panel.example/clip/ingest</string>
    <string>-token</string><string>TOKEN</string>
    <string>-room</string><string>otagh1</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/clip.agent.plist
```

Use a LaunchAgent (per-user), not a LaunchDaemon — a daemon has no user clipboard.

### Linux (systemd user service; needs a graphical session)

```bash
sudo apt install -y wl-clipboard   # or xclip / xsel
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/clip-agent.service <<'EOF'
[Unit]
Description=Clipboard agent
[Service]
ExecStart=/usr/local/bin/clipboard-agent -server https://panel.example/clip/ingest -token TOKEN -room otagh1
Restart=always
[Install]
WantedBy=default.target
EOF
systemctl --user enable --now clip-agent.service
loginctl enable-linger "$USER"   # keep the user service alive
```

Use `systemctl --user` (not a system service) so it inherits the desktop session.

## Panel side

The agent posts JSON `{host, room, ts, content}` with `Authorization: Bearer <token>`.
The receiving ingest endpoint + Monitoring view live in the panel (separate step).
