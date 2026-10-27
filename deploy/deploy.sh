#!/usr/bin/env bash
# Build and ship a release from your machine (the GitHub Actions workflow does the same on every push to main).
# Usage: deploy/deploy.sh user@host [ssh-key]
set -euo pipefail
target="${1:?user@host}"
key="${2:+-i $2}"
cd "$(dirname "$0")/.."
sha="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
npm ci
npm run build:node
tar -czf "/tmp/imbox-$sha.tgz" dist node-dist server package.json package-lock.json
# shellcheck disable=SC2086
scp $key "/tmp/imbox-$sha.tgz" "$target:/tmp/"
# shellcheck disable=SC2086
ssh $key "$target" "sudo imbox-activate /tmp/imbox-$sha.tgz $sha"
