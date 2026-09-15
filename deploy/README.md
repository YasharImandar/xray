# Cloud deployment (unattended install)

Tooling to ship the 3x-ui panel via unattended install, with **per-instance
credentials generated on first boot** (never `admin/admin`, never a shared
session secret). Works on amd64 and arm64.

## Never build on the live VPS

The panel host is not a build machine. Compiling this repo on the server
(CGO sqlite3 + Xray-core) can OOM the box and drop SSH.

**Allowed on the VPS:** drop a prebuilt `x-ui` binary (from GitHub Releases
or a local/CI linux-amd64 build) at `/usr/local/x-ui/x-ui` and restart
`x-ui`. `install.sh` / panel Update already do this.

**Forbidden on the VPS:** `go build`, `make build`, `npm run build`,
installing Go/Node/gcc, rsyncing the repo to compile in `/tmp`, or
"temporary" `nohup` compiles. If Actions is billed-locked, build on a
dev machine or Docker — never on the live host.

## Local check (do this instead of the VPS)

Verify on the development machine:

```bash
make check    # Go + frontend unit/component tests
make run      # panel at http://127.0.0.1:2053 (admin/admin)
```

`make linux-amd64` builds `/x-ui-linux-amd64` in local Docker. Copy that
file to the server only when you are actually shipping — not to test.

| Path | What it is | Use when |
| --- | --- | --- |
| [`cloud-init/`](cloud-init/) | Generic cloud-init user-data (unattended `install.sh`) | Any cloud, no image build |
| [`marketplace/hetzner/`](marketplace/hetzner/) | Hetzner Cloud notes | Hetzner deployments |
| [`test/`](test/) | Container smoke test | Verifying the install path |

## How it works

`install.sh` runs unattended when `XUI_NONINTERACTIVE=1` or stdin is not a TTY.
Each instance installs and configures itself with random credentials. See
[`cloud-init/README.md`](cloud-init/README.md).

## Unattended install knobs

`install.sh` reads these env vars in non-interactive mode (all optional; unset ⇒
secure random / default):

`XUI_USERNAME`, `XUI_PASSWORD`, `XUI_PANEL_PORT`, `XUI_WEB_BASE_PATH`,
`XUI_SSL_MODE` (`none`|`ip`|`domain`, default `none`), `XUI_DOMAIN`,
`XUI_ACME_EMAIL`, `XUI_ACME_HTTP_PORT` (ACME HTTP-01 listener port, default `80`),
`XUI_SSL_IPV6` (optional IPv6 address to add to an `ip`-mode cert),
`XUI_SERVER_IP` (fallback IP for the displayed access URL when auto-detection fails),
`XUI_DB_TYPE` (`sqlite`|`postgres`), `XUI_DB_DSN`.

The resulting credentials are written to `/etc/x-ui/install-result.env` (mode 600).
