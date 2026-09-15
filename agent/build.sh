#!/usr/bin/env bash
# Cross-compiles the clipboard agent for every target into dist/. No cgo.
set -euo pipefail
cd "$(dirname "$0")"

out=dist
mkdir -p "$out"
targets=(windows/amd64 windows/386 windows/arm64 darwin/arm64 darwin/amd64 linux/amd64 linux/arm64)

for t in "${targets[@]}"; do
	os=${t%/*}
	arch=${t#*/}
	ext=""
	[ "$os" = windows ] && ext=".exe"
	bin="$out/clipboard-agent-$os-$arch$ext"
	CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags="-s -w" -o "$bin" .
	printf "%-16s %6s  %s\n" "$t" "$(du -h "$bin" | cut -f1)" "$bin"
done
