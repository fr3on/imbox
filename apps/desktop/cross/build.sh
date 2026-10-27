#!/usr/bin/env bash
# Builds the Windows installer, the Linux AppImage and the .deb into apps/desktop/cross/out (run from anywhere).
#   apps/desktop/cross/build.sh [linux|windows|all]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
what="${1:-all}"
mkdir -p "$here/out"
# The source is copied in, so the build never writes into the working tree; cargo's target directory stays in a named volume between runs.
run() { # run <ubuntu version> <linux|windows>
  docker build --platform linux/amd64 --build-arg BASE="ubuntu:$1" -t "imbox-desktop-cross:$1" "$here"
  docker run --rm --platform linux/amd64 \
  -v "$repo":/host:ro -v "$here/out":/out -v imbox-cross-target:/target -v imbox-cross-registry:/opt/cargo/registry \
  -e WHAT="$2" -e CARGO_TARGET_DIR=/target "imbox-desktop-cross:$1" bash -ec '
    mkdir -p /src && cd /host && tar --exclude=node_modules --exclude=target --exclude=.git --exclude=cross/out -cf - apps/desktop | tar -xf - -C /src
    cd /src/apps/desktop && npm ci --no-audit --no-fund
    if [ "$WHAT" = linux ]; then
      npx tauri build --bundles appimage,deb
      cp /target/release/bundle/appimage/*.AppImage /target/release/bundle/deb/*.deb /out/
    fi
    if [ "$WHAT" = windows ]; then
      npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
      cp /target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe /out/
    fi
  '
}
if [ "$what" = linux ] || [ "$what" = all ]; then run 22.04 linux; fi
if [ "$what" = windows ] || [ "$what" = all ]; then run 24.04 windows; fi
ls -la "$here/out"
