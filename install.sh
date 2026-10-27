#!/usr/bin/env bash
# Imbox installer. Sets up Imbox, its PostgreSQL and Caddy (automatic HTTPS) as one Docker Compose stack on a Linux server.
#
#   curl -fsSL https://imbox.lol/install.sh | sudo bash
#
# Run it again to update: it keeps your settings and generated secrets, pulls the newest image and restarts what changed.
#
# Options, as environment variables (put them after sudo, for example: curl ... | sudo IMBOX_DOMAIN=mail.example.com bash):
#   IMBOX_DOMAIN       The address Imbox answers on. Default: <your IP>.sslip.io, which gets a real certificate with no DNS setup.
#                      For your own domain, point its DNS A record at this server first.
#   IMBOX_DIR          Where the files live. Default /opt/imbox.
#   IMBOX_VERSION      Image tag: "latest" or a short commit. Default latest.
#   IMBOX_IMAGE        Image name. Default fr3on/imbox (Docker Hub).
#   IMBOX_PROJECT      Docker Compose project name. Default imbox.
#   IMBOX_HTTP_PORT    Host ports for Caddy. Default 80 and 443. Certificates need the defaults; other ports suit a test, or your own proxy.
#   IMBOX_HTTPS_PORT
#   IMBOX_BIND_ADDR    Address Caddy listens on. Default 0.0.0.0 (every interface). Use 127.0.0.1 to keep it off the network, for a test or your own proxy.
#   IMBOX_NO_CRON      Set to 1 to skip the nightly database backup job.
#   IMBOX_DRY_RUN      Set to 1 to check the server and print the plan and the files, changing nothing.
#
# What it does: checks the server, installs Docker if it is missing, writes docker-compose.yml, Caddyfile and .env (secrets generated once)
# into IMBOX_DIR, starts the stack, waits for it to be healthy, and adds a nightly backup (14 days kept in IMBOX_DIR/backups).
set -euo pipefail

IMBOX_DIR=${IMBOX_DIR:-/opt/imbox}
IMBOX_IMAGE=${IMBOX_IMAGE:-fr3on/imbox}
IMBOX_VERSION=${IMBOX_VERSION:-}
IMBOX_DOMAIN=${IMBOX_DOMAIN:-}
IMBOX_PROJECT=${IMBOX_PROJECT:-imbox}
IMBOX_HTTP_PORT=${IMBOX_HTTP_PORT:-80}
IMBOX_HTTPS_PORT=${IMBOX_HTTPS_PORT:-443}
IMBOX_BIND_ADDR=${IMBOX_BIND_ADDR:-0.0.0.0}
IMBOX_NO_CRON=${IMBOX_NO_CRON:-0}
IMBOX_DRY_RUN=${IMBOX_DRY_RUN:-0}

if [ -t 1 ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'; else B=""; R=""; G=""; Y=""; N=""; fi
say()  { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
warn() { printf '%swarning:%s %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
dry()  { [ "$IMBOX_DRY_RUN" = 1 ]; }
stop() { if dry; then warn "$* (a real run would stop here)"; else die "$*"; fi; }

case "${1:-}" in -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac

# ---------- checks ----------
say "Checking the server"
[ "$(uname -s)" = Linux ] || stop "this installer is for Linux servers (this is $(uname -s))."
if ! dry && [ "$(id -u)" -ne 0 ]; then die "run it as root: curl -fsSL <address>/install.sh | sudo bash"; fi
arch=$(uname -m)
case "$arch" in x86_64|amd64) ;; *) stop "the Imbox image is built for x86_64 only (this is $arch)." ;; esac
if [ -r /etc/os-release ]; then . /etc/os-release; os="${ID:-linux} ${VERSION_ID:-}"; else os=linux; fi
case "${ID:-}" in debian|ubuntu) ;; *) command -v docker >/dev/null 2>&1 || stop "automatic Docker setup supports Debian and Ubuntu (this is $os). Install Docker yourself and run this again." ;; esac
mem_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
[ "$mem_mb" -ge 1500 ] || warn "only ${mem_mb} MB of memory; Imbox is comfortable from 2 GB."
echo "  $os, $arch, ${mem_mb} MB"

port_busy() { ss -ltn "sport = :$1" 2>/dev/null | tail -n +2 | grep -q .; }
ours_running=0
if command -v docker >/dev/null 2>&1 && docker compose -p "$IMBOX_PROJECT" ps -q 2>/dev/null | grep -q .; then ours_running=1; fi
if [ "$ours_running" = 0 ]; then
  for p in "$IMBOX_HTTP_PORT" "$IMBOX_HTTPS_PORT"; do
    port_busy "$p" && die "port $p is already in use (another web server?). Stop it, or choose other ports with IMBOX_HTTP_PORT and IMBOX_HTTPS_PORT (HTTPS certificates need 80 and 443)."
  done
fi

# the address
if [ -z "$IMBOX_DOMAIN" ]; then
  ip=$(curl -4fsS -m 8 https://api.ipify.org 2>/dev/null || curl -4fsS -m 8 https://ifconfig.me 2>/dev/null || true)
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not find this server's public IP. Set IMBOX_DOMAIN=your.domain.example"
  IMBOX_DOMAIN="${ip//./-}.sslip.io"
  echo "  no IMBOX_DOMAIN given, using $IMBOX_DOMAIN (a name that points at $ip)"
fi
[[ "$IMBOX_DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "IMBOX_DOMAIN '$IMBOX_DOMAIN' is not a host name."
[[ "$IMBOX_HTTP_PORT" =~ ^[0-9]+$ && "$IMBOX_HTTPS_PORT" =~ ^[0-9]+$ ]] || die "IMBOX_HTTP_PORT and IMBOX_HTTPS_PORT must be numbers."
[[ "$IMBOX_BIND_ADDR" =~ ^[0-9.]+$ ]] || die "IMBOX_BIND_ADDR must be an IPv4 address such as 0.0.0.0 or 127.0.0.1."
[[ "$IMBOX_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "IMBOX_PROJECT must be lowercase letters, digits, - or _."
app_url="https://$IMBOX_DOMAIN"; [ "$IMBOX_HTTPS_PORT" = 443 ] || app_url="$app_url:$IMBOX_HTTPS_PORT"

# ---------- the files ----------
gen_secret() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

compose_file() {
echo "# Written by install.sh; running the installer again rewrites this file. Your settings are in .env."
echo "name: $IMBOX_PROJECT"
cat <<'YAML'
services:
  imbox:
    image: ${IMBOX_IMAGE}:${IMBOX_VERSION}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://imbox:${POSTGRES_PASSWORD}@db:5432/imbox
      APP_URL: ${APP_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      APP_NAME: ${APP_NAME:-imbox}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      MS_CLIENT_ID: ${MS_CLIENT_ID:-}
      MS_CLIENT_SECRET: ${MS_CLIENT_SECRET:-}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
    expose:
      - "8787"
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: imbox
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: imbox
    volumes:
      - db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U imbox -d imbox"]
      interval: 5s
      timeout: 5s
      retries: 20
  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - imbox
    ports:
      - "${IMBOX_BIND_ADDR}:${IMBOX_HTTP_PORT}:80"
      - "${IMBOX_BIND_ADDR}:${IMBOX_HTTPS_PORT}:443"
    environment:
      IMBOX_DOMAIN: ${IMBOX_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
volumes:
  db:
  caddy_data:
  caddy_config:
YAML
}

caddyfile() {
cat <<'CADDY'
# Written by install.sh. HTTPS certificates are fetched and renewed by Caddy on its own.
{$IMBOX_DOMAIN} {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy imbox:8787 {
		transport http {
			response_header_timeout 120s
		}
	}
}
CADDY
}

env_file() { # the values that change: written once, and the settings you add later are kept
cat <<ENV
# Imbox settings. Keep a copy of SESSION_SECRET somewhere else: everything stored encrypted (mailbox passwords, AI keys) is unreadable without it.
# Change a value, then: cd $IMBOX_DIR && docker compose up -d
IMBOX_PROJECT=$IMBOX_PROJECT
IMBOX_IMAGE=$IMBOX_IMAGE
IMBOX_VERSION=$IMBOX_VERSION
IMBOX_DOMAIN=$IMBOX_DOMAIN
IMBOX_HTTP_PORT=$IMBOX_HTTP_PORT
IMBOX_HTTPS_PORT=$IMBOX_HTTPS_PORT
IMBOX_BIND_ADDR=$IMBOX_BIND_ADDR
APP_URL=$app_url
POSTGRES_PASSWORD=$1
SESSION_SECRET=$2
#APP_NAME=imbox
#GOOGLE_CLIENT_ID=
#GOOGLE_CLIENT_SECRET=
#MS_CLIENT_ID=
#MS_CLIENT_SECRET=
#RESEND_API_KEY=
ENV
}

# a rerun keeps the secrets and any settings added by hand; the managed values are updated from the options given now
existing_env=0; [ -f "$IMBOX_DIR/.env" ] && existing_env=1
if [ $existing_env = 1 ]; then
  pw=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$IMBOX_DIR/.env" | tail -1); sec=$(sed -n 's/^SESSION_SECRET=//p' "$IMBOX_DIR/.env" | tail -1)
  [ -n "$pw" ] && [ -n "$sec" ] || die "$IMBOX_DIR/.env exists but has no POSTGRES_PASSWORD or SESSION_SECRET. Fix or remove it."
  [ -n "$IMBOX_VERSION" ] || IMBOX_VERSION=$(sed -n 's/^IMBOX_VERSION=//p' "$IMBOX_DIR/.env" | tail -1)
else
  pw=$(gen_secret); sec=$(gen_secret)
fi
IMBOX_VERSION=${IMBOX_VERSION:-latest}

if dry; then
  say "Dry run: nothing is installed or changed. A real run would write these into $IMBOX_DIR:"
  echo; echo "--- .env (secrets hidden)"; env_file "<generated once>" "<generated once>"
  echo; echo "--- Caddyfile"; caddyfile
  echo; echo "--- docker-compose.yml"; compose_file
  echo; say "then: install Docker if missing, pull $IMBOX_IMAGE:$IMBOX_VERSION, start the stack, wait for it, add the nightly backup, and open ports 80/443 if ufw is on (standard setup only)."
  echo "The address would be $app_url"
  exit 0
fi

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker (the official get.docker.com script)"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || die "the Docker install failed. Install Docker yourself (https://docs.docker.com/engine/install/) and run this again."
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the docker-compose-plugin package). Install it and run this again."
docker info >/dev/null 2>&1 || die "Docker is installed but not running."

# ---------- write and start ----------
say "Writing the files into $IMBOX_DIR"
install -d -m 755 "$IMBOX_DIR" "$IMBOX_DIR/backups"
chmod 700 "$IMBOX_DIR/backups"
if [ $existing_env = 1 ]; then
  cp -p "$IMBOX_DIR/.env" "$IMBOX_DIR/.env.bak"
  # update the managed values in place, keep everything else
  for kv in "IMBOX_PROJECT=$IMBOX_PROJECT" "IMBOX_IMAGE=$IMBOX_IMAGE" "IMBOX_VERSION=$IMBOX_VERSION" "IMBOX_DOMAIN=$IMBOX_DOMAIN" \
            "IMBOX_HTTP_PORT=$IMBOX_HTTP_PORT" "IMBOX_HTTPS_PORT=$IMBOX_HTTPS_PORT" "IMBOX_BIND_ADDR=$IMBOX_BIND_ADDR" "APP_URL=$app_url"; do
    k=${kv%%=*}
    if grep -q "^$k=" "$IMBOX_DIR/.env"; then
      tmp=$(mktemp); awk -v k="$k" -v line="$kv" 'BEGIN{FS=OFS="="} $1==k {print line; next} {print}' "$IMBOX_DIR/.env" > "$tmp" && cat "$tmp" > "$IMBOX_DIR/.env"; rm -f "$tmp"
    else echo "$kv" >> "$IMBOX_DIR/.env"; fi
  done
  echo "  kept $IMBOX_DIR/.env (secrets and your settings), previous copy in .env.bak"
else
  ( umask 077; env_file "$pw" "$sec" > "$IMBOX_DIR/.env" )
  echo "  wrote $IMBOX_DIR/.env with new secrets"
fi
chmod 600 "$IMBOX_DIR/.env"
compose_file > "$IMBOX_DIR/docker-compose.yml"
caddyfile > "$IMBOX_DIR/Caddyfile"

cd "$IMBOX_DIR"
docker compose config -q 2>/dev/null || die "the generated docker-compose.yml is not valid; run: cd $IMBOX_DIR && docker compose config"
say "Pulling the images ($IMBOX_IMAGE:$IMBOX_VERSION, postgres, caddy)"
docker compose pull --quiet || die "could not pull the images. If $IMBOX_IMAGE is private, run 'docker login' first; or set IMBOX_IMAGE to an image you can reach."
say "Starting Imbox"
docker compose up -d
say "Waiting for Imbox to be healthy (the first start creates the database tables)"
cid=$(docker compose ps -q imbox)
ok=0
for _ in $(seq 1 90); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo missing)
  case "$st" in healthy|running) ok=1; break ;; esac
  sleep 2
done
if [ $ok -ne 1 ]; then
  docker compose logs --tail 30 imbox >&2 || true
  die "Imbox did not become healthy. See the log above, or: cd $IMBOX_DIR && docker compose logs"
fi

# ---------- firewall and backups ----------
if [ "$IMBOX_BIND_ADDR" = 0.0.0.0 ] && [ "$IMBOX_HTTP_PORT" = 80 ] && [ "$IMBOX_HTTPS_PORT" = 443 ]; then
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    say "ufw is on: allowing ports 80 and 443"
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  fi
else
  echo "  firewall left alone (not the standard 0.0.0.0:80/443 setup); open what you need yourself"
fi
if [ "$IMBOX_NO_CRON" != 1 ] && [ -d /etc/cron.d ]; then
  cat > "/etc/cron.d/$IMBOX_PROJECT-backup" <<CRON
# Written by install.sh: a nightly dump of the Imbox database, 14 days kept. Restore: see imbox-website/docs/content/docs/backups.mdx
17 3 * * * root cd $IMBOX_DIR && umask 077 && docker compose exec -T db pg_dump -U imbox imbox | gzip > backups/imbox-\$(date +\%Y\%m\%dT\%H\%M\%S).sql.gz && find backups -name 'imbox-*.sql.gz' -mtime +14 -delete
CRON
  chmod 644 "/etc/cron.d/$IMBOX_PROJECT-backup"
  echo "  nightly database backup at 03:17 into $IMBOX_DIR/backups (14 days kept)"
else
  warn "no nightly backup was set up. Back up the database yourself; see imbox-website/docs/content/docs/backups.mdx"
fi

cat <<DONE

${G}${B}Imbox is running.${N}

  Open        $app_url
              (the first visit asks you to create the owner account)
  Files       $IMBOX_DIR   (docker-compose.yml, Caddyfile, .env)
  Logs        cd $IMBOX_DIR && docker compose logs -f
  Update      curl -fsSL https://imbox.lol/install.sh | sudo bash
  Stop        cd $IMBOX_DIR && docker compose down        (your data stays in the Docker volumes)

${B}Keep a copy of SESSION_SECRET${N} (in $IMBOX_DIR/.env) somewhere safe. Without it, stored mailbox passwords and keys cannot be read after a restore.
DONE
case "$IMBOX_DOMAIN" in *.sslip.io) echo "The address ends in .sslip.io, a free name for this IP. For your own domain, point its DNS at this server and run the installer again with IMBOX_DOMAIN=your.domain." ;; esac
