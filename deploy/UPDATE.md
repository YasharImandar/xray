# Safe panel update (binary only)

This host is production. Updating the panel must never compile on the VPS.
A `go build` / toolchain install on a 1 GB box OOMs the machine and drops SSH.

## What is allowed on the VPS

- Copy one prebuilt `x-ui` file onto `/usr/local/x-ui/x-ui`
- `systemctl restart x-ui` (brief xray/mtg bounce — inbounds drop for a few seconds)
- Read-only checks (`systemctl`, `ss`, `x-ui -v`)

## What is forbidden on the VPS

- `go build`, `make build`, `npm run build`, `nohup` compiles
- Installing Go, Node, gcc
- rsyncing this repo to `/tmp` to compile
- Changing `/etc/x-ui/x-ui.db`, inbound settings, nginx, or certs as part of an update

Build on a dev machine (Docker) or CI. Then place the file.

## Build the linux-amd64 binary locally

From a clone of this repo (macOS/Windows: Docker is required because of CGO):

```bash
make check
make linux-amd64
# or, same thing:
# docker run --rm --platform linux/amd64 \
#   -v "$PWD":/src -v xui-gomod:/go/pkg/mod -v xui-gocache:/root/.cache/go-build \
#   -w /src golang:1.27.1-bookworm \
#   bash -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gcc libc6-dev >/dev/null && CGO_ENABLED=1 go build -trimpath -ldflags "-w -s" -o /src/x-ui-linux-amd64 .'
```

Confirm `file x-ui-linux-amd64` is `ELF 64-bit LSB` `x86-64` and
`./x-ui-linux-amd64` is **not** run on the Mac (wrong OS). The version string
is checked on the server after upload (`x-ui.new -v`).

## Swap on the server (staging name first)

Replace `HOST` with the panel host. Do not overwrite the live binary until
`-v` and `ldd` succeed.

```bash
scp x-ui-linux-amd64 root@HOST:/usr/local/x-ui/x-ui.new

ssh root@HOST 'set -euo pipefail
test "$(/usr/local/x-ui/x-ui.new -v)" = "3.8.6"
ldd /usr/local/x-ui/x-ui.new
cp -a /usr/local/x-ui/x-ui /usr/local/x-ui/x-ui.bak-$(/usr/local/x-ui/x-ui -v)
mv /usr/local/x-ui/x-ui.new /usr/local/x-ui/x-ui
chmod +x /usr/local/x-ui/x-ui
systemctl restart x-ui
'
```

`x-ui.new -v` only prints the version and exits. It does not take the
ports. `systemctl restart x-ui` restarts the panel **and** its xray/mtg
children — that is the only user-visible blip.

## Verify before walking away

These listeners must come back (this fork's mtproxier layout):

| Port | Process | Role |
| --- | --- | --- |
| 443 | x-ui | panel HTTPS (`/xray/`) |
| 2096 | x-ui | subscription |
| 8443 | xray | MTProxier VLESS |
| 4443 | mtg | Telegram |
| 2053 | xray | Extension HTTP |

```bash
ssh root@HOST 'systemctl is-active x-ui; /usr/local/x-ui/x-ui -v
ss -lnt | grep -E ":443 |:2053 |:8443 |:4443 |:2096 "
curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1/xray/'
```

Public check: `https://mtproxier.ir/xray/` → 200.

## Rollback

```bash
ssh root@HOST 'cp -a /usr/local/x-ui/x-ui.bak-3.8.2 /usr/local/x-ui/x-ui
systemctl restart x-ui'
```

Use the `.bak-*` filename that was created in the swap step.

## Reload xray only (config, not binary)

`systemctl reload x-ui` sends USR1. That regenerates `bin/config.json` from
the DB and restarts **xray only**. The panel process stays up. Use this when
turning the access log / sniffing on — not for a binary replace.

## Why Monitoring was empty

Xray's default template had `"log.access": "none"`. The Monitoring page
reads that file; with `none` it cannot show destinations. Enabling
`access.log` (and sniffing on inbound Extension) is a config change, not a
compile. HTTPS page path and body stay encrypted — access log is host/SNI,
not MITM.
