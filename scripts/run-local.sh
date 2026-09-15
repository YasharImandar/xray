#!/usr/bin/env bash
# Run the panel on this machine. Do not use a live VPS to try changes.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
mkdir -p x-ui

set -a
# shellcheck disable=SC1091
source .env
set +a

echo "local panel: http://127.0.0.1:${XUI_PORT:-2053}  (admin / admin)"
exec go run .
