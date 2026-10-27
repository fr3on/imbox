# Imbox

A calm email client for mail you host yourself. One owner, one small server, one PostgreSQL database.

Imbox reads your Gmail, your Outlook and any other mailbox, and puts all of it behind one quiet screen. New senders wait in the Screener for your yes or no before they reach you. People come first, and newsletters and receipts stay out of the way. An optional AI assistant helps when you ask it to, and never sends anything without you.

Source, issues and docs: https://git.0x200.com/fr3on/imbox

## Tags

| Tag | What it is |
|---|---|
| `latest` | The newest build of `main`. |
| `<short commit>` | One build, for example `cd7b095e`. Pin a deployment to one of these so you can go back to it. |

The image is `linux/amd64`. The About dialog and `/api/version` report the commit the image was built from.

## Run it

The image is the app only (the API and the web app, on Node.js, listening on port 8787). It needs PostgreSQL (developed and tested on 16, and runs on 17), and a proxy in front for HTTPS.

With Docker Compose, in an empty folder:

```yaml
services:
  imbox:
    image: fr3on/imbox:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://imbox:${POSTGRES_PASSWORD}@db:5432/imbox
      APP_URL: https://imbox.example.com
      SESSION_SECRET: ${SESSION_SECRET}
    ports:
      - "127.0.0.1:8787:8787"
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
      test: ["CMD-SHELL", "pg_isready -U imbox"]
      interval: 5s
      retries: 10
volumes:
  db:
```

Put `POSTGRES_PASSWORD` and `SESSION_SECRET` in a `.env` next to it (`openssl rand -hex 32` makes a good secret), then `docker compose up -d`. Point a TLS proxy such as Caddy at `127.0.0.1:8787`, open your address, create the owner login, then add a mailbox.

If the repository is private, run `docker login` with an account that can read `fr3on/imbox` first.

Without Compose, against a PostgreSQL you already run:

```sh
docker run -d --name imbox --restart unless-stopped -p 127.0.0.1:8787:8787 \
  -e DATABASE_URL=postgres://imbox:PASSWORD@host:5432/imbox \
  -e APP_URL=https://imbox.example.com \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  fr3on/imbox:latest
```

## Settings

| Setting | |
|---|---|
| `DATABASE_URL` | Required. The PostgreSQL address. |
| `APP_URL` | Required. The public address with `https://`. It must match the address in your browser. |
| `SESSION_SECRET` | Required. Signs sessions and encrypts stored mailbox passwords and keys. **Never change it once mail is connected**, and keep a copy off the server. |
| `HOST`, `PORT` | Listen address and port. Default `0.0.0.0` and `8787` inside the container. |
| `APP_NAME` | The name on the sign-in page. Default `imbox`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Gmail and Google Calendar. |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | Optional. Outlook and Microsoft 365. |
| `RESEND_API_KEY` | Optional. Sending from domain mailboxes. |
| `WEB_CONCURRENCY`, `PG_POOL_MAX`, `CRON_SECONDS` | Optional tuning. |

Every setting is listed in the [configuration guide](https://imbox.lol/docs/configuration).

## Good to know

- **Health check.** `GET /healthz` returns `{"ok":true}`. The image has a Docker health check on it.
- **Migrations.** The app creates and updates its tables on start. Migrations only add tables and columns, so the previous image still works on a newer database and you can go back. Take a backup before an update all the same.
- **Nothing to mount.** The container writes nothing to disk. Everything lives in PostgreSQL, so the database is your backup. See the [backup guide](https://imbox.lol/docs/backups).
- **Updating.** Pull the new tag and recreate the container: `docker compose pull && docker compose up -d`. To go back, run the previous tag.
- **Privacy.** Very little leaves your server. The privacy page on the project website lists every outside address it can contact.

## License

MIT. Imbox is an independent project, not affiliated with HEY, Basecamp or 37signals.
