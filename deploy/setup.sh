#!/usr/bin/env bash
# One-time setup of a fresh Debian 12/13 or Ubuntu 22.04/24.04 (x86_64 or arm64) instance: Node 22, PostgreSQL, Caddy, the imbox user, systemd unit, nightly backups.
# Run as root:  IMBOX_DOMAIN=imbox.example.com bash setup.sh
set -euo pipefail

: "${IMBOX_DOMAIN:?set IMBOX_DOMAIN, the hostname this server will answer on}"
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw unzip openssl sudo
# age encrypts the nightly backup when backup.env names a recipient; without it backups are written as they are.
apt-get install -y age || echo "age not installed; encrypted backups will not work until it is (apt-get install age)"

# Node 22
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# PostgreSQL: whatever the distribution ships (16 on Ubuntu 24.04, 17 on Debian 13); the app only needs 14 or newer
command -v psql >/dev/null || apt-get install -y postgresql
systemctl enable --now postgresql

# AWS CLI, only for off-server backups (not packaged on every release)
if ! command -v aws >/dev/null; then
  arch="$(uname -m)"
  # In a private directory: a fixed name in /tmp could be swapped by another user between the download and the install, which runs as root.
  awstmp="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$arch.zip" -o "$awstmp/awscli.zip" && unzip -q -o "$awstmp/awscli.zip" -d "$awstmp" && "$awstmp/aws/install" >/dev/null || echo "aws cli not installed; off-server backups will not work until it is"
  rm -rf "$awstmp"
fi

# Caddy
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# The service user and directories
id imbox >/dev/null 2>&1 || useradd --system --home /var/lib/imbox --shell /usr/sbin/nologin imbox
install -d -o imbox -g imbox /opt/imbox/releases /var/lib/imbox
install -d -m 750 /etc/imbox
# Backups belong to root alone: the service user runs code that reads mail from strangers, and must not be able to read, replace or delete a dump.
install -d -m 700 -o root -g root /var/backups/imbox

# The database, with a generated password (kept only in the env file)
if [ ! -f /etc/imbox/imbox.env ]; then
  pw="$(openssl rand -hex 24)"
  secret="$(openssl rand -hex 32)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'imbox') THEN CREATE ROLE imbox LOGIN PASSWORD '$pw'; END IF;
END \$\$;
SQL
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='imbox'" | grep -q 1 || sudo -u postgres createdb -O imbox imbox
  sed -e "s#CHANGE_ME@127.0.0.1#$pw@127.0.0.1#" -e "s#^SESSION_SECRET=.*#SESSION_SECRET=$secret#" -e "s#https://imbox.example.com#https://$IMBOX_DOMAIN#" "$here/imbox.env.example" > /etc/imbox/imbox.env
  chmod 600 /etc/imbox/imbox.env
  echo "Wrote /etc/imbox/imbox.env"
fi

# systemd, Caddy, backups
install -m 644 "$here/imbox.service" /etc/systemd/system/imbox.service
sed "s#{\$IMBOX_DOMAIN}#$IMBOX_DOMAIN#" "$here/Caddyfile" > /etc/caddy/Caddyfile
install -m 755 "$here/activate.sh" /usr/local/bin/imbox-activate
install -m 755 "$here/backup.sh" /usr/local/bin/imbox-backup
cat > /etc/cron.d/imbox-backup <<CRON
17 3 * * * root /usr/local/bin/imbox-backup >> /var/log/imbox-backup.log 2>&1
CRON
systemctl daemon-reload
systemctl enable imbox
systemctl reload caddy || systemctl restart caddy

# Firewall: ssh, http, https
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

cat <<MSG

Setup done. Next:
  1. Point DNS for $IMBOX_DOMAIN at this server's public IP (Caddy fetches the certificate once it resolves).
  2. Deploy a release (the GitHub Actions workflow does this on every push to main, or run deploy/deploy.sh from your machine).
  3. Open https://$IMBOX_DOMAIN and create the owner account.
Backups: nightly dumps are NOT encrypted until you set BACKUP_AGE_RECIPIENT=<public key from age-keygen> in /etc/imbox/backup.env, and S3_BUCKET=... there copies them off the server. See imbox-website/docs/content/docs/backups.mdx.
MSG
