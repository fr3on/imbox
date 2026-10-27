# Builds the Windows and Linux desktop apps on any machine with Docker (a Mac included), as an x86_64 Linux container.
# The Linux app is built natively; the Windows installer is cross-compiled with cargo-xwin. See cross/build.sh.
# Linux builds on 22.04 so the AppImage runs on older systems; the Windows installer needs NSIS 3.08 or later, which 24.04 has.
ARG BASE=ubuntu:22.04
FROM --platform=linux/amd64 ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential file xz-utils patchelf pkg-config \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    nsis clang lld llvm \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal \
 && rustup target add x86_64-pc-windows-msvc \
 && cargo install --locked cargo-xwin
# linuxdeploy (inside tauri's AppImage step) is itself an AppImage and needs FUSE, which a container lacks.
ENV APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true
WORKDIR /src/apps/desktop
