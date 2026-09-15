#!/usr/bin/env bash
# Produce the linux/amd64 x-ui binary here (Docker). Never compile on the VPS.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/x-ui-linux-amd64}"
cd "$root"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build linux/amd64 on this host" >&2
  exit 1
fi

docker build --platform linux/amd64 --target builder -t x-ui-linux-amd64-builder .
cid="$(docker create --platform linux/amd64 x-ui-linux-amd64-builder)"
cleanup() { docker rm -f "$cid" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker cp "$cid:/app/build/x-ui" "$out"
echo "wrote $out"
file "$out" || true
