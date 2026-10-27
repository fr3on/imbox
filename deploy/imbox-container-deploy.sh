#!/bin/bash
# Installed as /usr/local/bin/imbox-container-deploy on a server that runs Imbox as a Docker container. The CI deploy job calls it:
#   sudo imbox-container-deploy <tag>
# It pulls fr3on/imbox:<tag> from Docker Hub, swaps the container named `imbox`, waits for /healthz, and goes back to the previous container
# if the new one does not become healthy. Settings come from /etc/inbox/inbox.env, which is also where the database address lives.
# The container uses host networking, so it reaches the host's PostgreSQL on 127.0.0.1 and listens on PORT from that file (8787).
# The server must be logged in to Docker Hub (`docker login`) as root if the repository is private.
set -euo pipefail
tag="${1:?usage: imbox-container-deploy <tag>}"
[[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || { echo "bad tag: ${tag:0:40}" >&2; exit 2; }
IMAGE=fr3on/imbox
NAME=imbox
ENVFILE=/etc/inbox/imbox.env
[ -f "$ENVFILE" ] || ENVFILE=/etc/inbox/inbox.env
[ -f "$ENVFILE" ] || { echo "no env file at $ENVFILE" >&2; exit 1; }
port=$(sed -n 's/^PORT=//p' "$ENVFILE" | tail -1); port=${port:-8787}
healthy() { curl -fsS -m 3 "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; }

previous=$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null || true)
echo "pulling $IMAGE:$tag"
docker pull -q "$IMAGE:$tag" >/dev/null     # a failure here stops the script before anything is touched

if [ "$previous" = "$IMAGE:$tag" ] && [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] && healthy; then
  echo "$IMAGE:$tag is already running and healthy"; exit 0
fi

if docker inspect "$NAME" >/dev/null 2>&1; then
  docker rm -f "$NAME-prev" >/dev/null 2>&1 || true
  docker stop -t 20 "$NAME" >/dev/null
  docker rename "$NAME" "$NAME-prev"
fi
echo "starting $IMAGE:$tag on port $port (was: ${previous:-nothing})"
docker run -d --name "$NAME" --restart unless-stopped --network host --cap-drop ALL --security-opt no-new-privileges \
  --env-file "$ENVFILE" "$IMAGE:$tag" >/dev/null || true
ok=0
for _ in $(seq 1 45); do
  healthy && { ok=1; break; }
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)" = true ] || break
  sleep 2
done
if [ $ok -eq 1 ]; then
  docker rm -f "$NAME-prev" >/dev/null 2>&1 || true
  docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true   # unused images older than a week
  echo "healthy: $(curl -fsS -m 3 "http://127.0.0.1:$port/api/version" || true)"
  exit 0
fi
echo "the new container did not become healthy; last log lines:" >&2
docker logs --tail 25 "$NAME" >&2 || true
docker rm -f "$NAME" >/dev/null 2>&1 || true
if docker inspect "$NAME-prev" >/dev/null 2>&1; then
  docker rename "$NAME-prev" "$NAME"; docker start "$NAME" >/dev/null
  echo "went back to ${previous:-the previous container}" >&2
fi
exit 1
