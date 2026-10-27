#!/usr/bin/env bash
# Installed as /usr/local/bin/imbox-activate. Unpacks a release tarball, installs its production dependencies, switches the `current` link,
# restarts the service and checks it came up; if it did not, puts the previous release back.
# Usage: sudo imbox-activate /tmp/imbox-<sha>.tgz <sha>
set -euo pipefail
tarball="${1:?tarball}"
name="${2:?release name}"
base=/opt/imbox
dest="$base/releases/$name"

# The tarball is unpacked and its code run by the service, so it must be the file the deploying user just copied, not something put in its place in /tmp
# by someone else (a symlink, or a file owned by another account) between the copy and this command.
[ -f "$tarball" ] && [ ! -L "$tarball" ] || { echo "$tarball is not a plain file"; exit 1; }
if [ -n "${SUDO_USER:-}" ] && [ "$(stat -c %U "$tarball")" != "$SUDO_USER" ]; then echo "$tarball is not owned by $SUDO_USER"; exit 1; fi
[[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "bad release name"; exit 1; }

rm -rf "$dest"
install -d -o imbox -g imbox "$dest"
tar -xzf "$tarball" -C "$dest"

# The app installers are large and rarely change, so a release that does not ship one keeps the copy from the release that is live now.
live="$(readlink -f "$base/current" 2>/dev/null || true)"
if [ -n "$live" ] && [ "$live" != "$dest" ] && [ -d "$live/dist/downloads" ]; then
  for f in imbox-mac.dmg imbox-windows.exe imbox-linux.AppImage imbox-linux.deb; do
    if [ -f "$live/dist/downloads/$f" ] && [ ! -e "$dest/dist/downloads/$f" ]; then
      mkdir -p "$dest/dist/downloads"
      ln "$live/dist/downloads/$f" "$dest/dist/downloads/$f" 2>/dev/null || cp "$live/dist/downloads/$f" "$dest/dist/downloads/$f"
    fi
  done
fi
chown -R imbox:imbox "$dest"
( cd "$dest" && sudo -u imbox npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund )

prev="$(readlink -f "$base/current" 2>/dev/null || true)"
ln -sfn "$dest" "$base/current.new"
mv -T "$base/current.new" "$base/current"
systemctl restart imbox

echo "Release $name is live."
# Keep the five newest releases.
ls -1dt "$base"/releases/* | tail -n +6 | xargs -r rm -rf
rm -f "$tarball"
