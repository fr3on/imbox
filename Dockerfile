# Imbox for your own server: one container with the app (the API and the web app, on Node.js). It needs a PostgreSQL database; see docker-compose.yml.
# docker build -t imbox .

FROM node:26-trixie-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY . .
# What the About dialog and /api/version report. There is no .git folder in this build, so the workflow passes the commit in.
ARG GIT_COMMIT=
ARG BUILD_TIME=
# Where the About dialog sends people (see src/shared/buildInfo.ts). Empty means this project's GitHub page.
ARG REPO_URL=
ARG REPO_LABEL=
ENV GIT_COMMIT=$GIT_COMMIT BUILD_TIME=$BUILD_TIME REPO_URL=$REPO_URL REPO_LABEL=$REPO_LABEL
# The project website's address, when this install links to it (the 404 page offers it). Empty leaves the link out.
ARG VITE_WEBSITE_URL=https://imbox.lol
ENV VITE_WEBSITE_URL=$VITE_WEBSITE_URL
RUN npm run build:node

FROM node:26-trixie-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
# Security updates Debian has published since the base image was built (the build cache keeps this layer for a week).
RUN apt-get update && apt-get -y --no-install-recommends upgrade && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# The running app never calls npm, so the copy that ships in the base image (and its own dependencies, which scanners flag) is removed.
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /src/dist ./dist
# The one-line installer (curl -fsSL https://imbox.lol/install.sh | sudo bash) is served from the static folder.
COPY install.sh ./dist/install.sh
COPY --from=build /src/node-dist ./node-dist
COPY server ./server
# A home directory for the app user; nothing else is written.
RUN useradd --system --create-home --home-dir /home/inbox --shell /usr/sbin/nologin inbox && chown -R inbox:inbox /home/inbox
# Debian has no fix for CVE-2026-85091 (zlib), and nothing here uses the system zlib: Node bundles its own zlib and OpenSSL. So the package is
# removed, together with the packages that need it (apt and the OpenSSL libraries), instead of shipping a library that scanners flag. dpkg is told
# to ignore the dependencies because those packages depend on zlib1g; nothing runs apt or dpkg after this point.
RUN dpkg --purge --force-depends zlib1g libssl3t64 openssl-provider-legacy libapt-pkg7.0 apt
USER inbox
# Image metadata, shown by registries such as Docker Hub. The build arguments are the ones declared above, passed again for this stage.
ARG GIT_COMMIT=
ARG BUILD_TIME=
ARG REPO_URL=
LABEL org.opencontainers.image.title="imbox" \
      org.opencontainers.image.description="A calm, self-hosted email client with one owner. Needs PostgreSQL." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="$REPO_URL" \
      org.opencontainers.image.url="$REPO_URL" \
      org.opencontainers.image.revision="$GIT_COMMIT" \
      org.opencontainers.image.created="$BUILD_TIME"
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/run.mjs"]
