# Imbox

A calm email client for mail you host yourself.

Imbox reads your Gmail, your Outlook and any other mailbox, and puts all of it behind one quiet screen. New senders wait for your yes or no before they reach you. People come first. Newsletters and receipts stay out of the way. An optional AI assistant helps when you ask it to, and never sends anything without you.

You run it yourself, on a small Linux server. It has one owner, a black-and-white design, and a separate layout for phones that you add to your home screen.

[![CI][gh-badge]][gh-ci] [![Pipeline][pipeline-badge]][pipeline] [![Docker][docker-badge]][docker] [![License: MIT][license-badge]][license] ![Node 22+][node-badge] ![PostgreSQL 16][pg-badge]

[gh-badge]: https://github.com/fr3on/imbox/actions/workflows/ci.yml/badge.svg
[gh-ci]: https://github.com/fr3on/imbox/actions/workflows/ci.yml
[pipeline-badge]: https://git.0x200.com/fr3on/imbox/badges/main/pipeline.svg
[pipeline]: https://git.0x200.com/fr3on/imbox/-/pipelines
[docker-badge]: https://img.shields.io/badge/docker-fr3on%2Fimbox-black?logo=docker&logoColor=white
[docker]: https://hub.docker.com/r/fr3on/imbox
[license-badge]: https://img.shields.io/badge/license-MIT-black
[license]: LICENSE
[node-badge]: https://img.shields.io/badge/node-22%2B-black?logo=nodedotjs&logoColor=white
[pg-badge]: https://img.shields.io/badge/postgresql-16-black?logo=postgresql&logoColor=white


## See it

The Imbox, where mail from people lands, with what is waiting for your reply at the top:

![The Imbox](docs/screenshots/imbox.png)

## What it does

**Your mail, sorted by who it is from**

- **The Screener.** The first time someone writes to you, they wait in the Screener. You choose once where their mail goes, and the choice applies to every account you have connected.
- **Two places.** The **Imbox** holds mail from people. **Updates** holds newsletters, long reads, receipts and confirmations.
- **Working through mail.** Reply Later and Set Aside keep things you are not ready to answer. Bubble Up brings a thread back at a time you pick. Bundles fold a busy sender into one row.
- **One inbox for every account.** The composer has a From picker, with the addresses grouped by domain.
- **Away mode.** Set a return date and mail waits quietly. Imbox can send a short notice that you approve first.

**Finding things**

- **Search** matches every word you type, in any order, and puts the best match first. Each result says where the words were found. You can narrow it with `from:`, `to:`, `has:attachment`, `in:feed`, `is:unread`, `before:`, `after:` and `filename:`.
- **Contacts.** Each person has a page with what is waiting on you, what you are waiting on, a chart of messages over time, and the files you have exchanged.
- **Files.** Every attachment in one place, with a first-page preview for PDFs.

**Privacy**

- Tracking pixels are removed when mail arrives. Other remote images stay hidden until you show them.
- Very little leaves your server. Two things happen on their own, a check for new versions and the pictures of people who write to you, and each has a switch in Settings. Everything else needs a feature you turn on. The `/privacy` page of your own install lists every outside address it can contact.

**Calendar**

- Weeks, days and a year view. Google Calendar (two ways), subscribed `.ics` feeds, and a calendar for each mailbox that fills from email invitations.

**AI, only when you ask**

- An assistant at the bottom of every page (`Cmd+J`) that can search and read your mail and write drafts in your tone.
- A daily brief, summaries of long threads, and suggestions in the Screener.
- Bring your own model: Anthropic, OpenAI, xAI, OpenRouter, Gemini, or any OpenAI-compatible server.
- Agents that handle a mailbox for you, with strict limits. Mailboxes for outside AI agents, with their own API keys and webhooks.

**Your own mail server**

- Connect a [Stalwart](https://stalw.art) server and manage its domains and mailboxes from Imbox.

## Run it

It runs on one Linux machine, or anywhere that runs containers: Node.js and PostgreSQL, with Caddy in front for HTTPS. About 2 CPUs and 4 GB of memory is enough to start. The [Self-hosting](https://imbox.lol/docs/self-hosting) guide covers a server, and Docker is below.

The short version for your own server, on a fresh Debian or Ubuntu machine with a domain name pointing at it:

```sh
sudo IMBOX_DOMAIN=imbox.example.com bash deploy/setup.sh   # on the server: installs everything
bash deploy/deploy.sh user@imbox.example.com ~/.ssh/key    # on your computer: builds and ships
```

The one-line way, on a fresh Debian or Ubuntu server (x86_64) with ports 80 and 443 free. It installs Docker if needed, and sets up Imbox, PostgreSQL and Caddy with automatic HTTPS:

```sh
curl -fsSL https://imbox.lol/install.sh | sudo bash
```

With no domain it uses `<your IP>.sslip.io`, which gets a real certificate without any DNS setup. For your own domain, point its DNS at the server and add `IMBOX_DOMAIN=mail.example.com` after `sudo`. Run it again to update. [Read the script](install.sh) first if you like; its header lists every option, and `IMBOX_DRY_RUN=1` shows what it would do without doing it. The image it pulls is `fr3on/imbox` on Docker Hub, so that repository has to be public for other people's servers.

Or with Docker, anywhere that runs containers:

```sh
cp .env.example .env     # set POSTGRES_PASSWORD, APP_URL and SESSION_SECRET
docker compose up -d     # Imbox on 127.0.0.1:8787, with its own PostgreSQL
```

`docker-compose.yml` pulls the image from `ghcr.io`. The same image is published on Docker Hub as [`fr3on/imbox`](https://hub.docker.com/r/fr3on/imbox) (tags `latest` and `<short commit>`). To run that one, change `image:` in `docker-compose.yml` to `fr3on/imbox:latest`, or use the `build: .` line next to it to build from this checkout. The text for the Docker Hub page is in [`docs/dockerhub.md`](docs/dockerhub.md) (a full compose file, the settings, and how to update); it is pasted into Docker Hub by hand.

Open your address, create the owner login, then add a mailbox.

## CI and deployment

Imbox is developed on both GitHub ([`fr3on/imbox`](https://github.com/fr3on/imbox)) and GitLab, and the same checks run on either, so a fork works on both with no setup.

- **GitHub:** [`.github/workflows/`](.github/workflows) has the pull request checks (`ci.yml`), the release, Docker image and desktop builds. Pull requests use the issue and pull request templates in `.github/`.
- **GitLab:** [`.gitlab-ci.yml`](.gitlab-ci.yml) runs the same checks on every branch and merge request: the type check and the linter, the tests as parallel shards (each with its own PostgreSQL), and the self-hosted build with its end-to-end tests. Templates are in `.gitlab/`.
- **Maintainer-only jobs:** the image build, the Docker Hub publish and the deploy jobs in `.gitlab-ci.yml` only exist on the maintainer's own GitLab server (`CI_SERVER_HOST`), so a fork's pipeline runs the tests and nothing that needs a private registry or server. On that server, the Docker Hub publish and the production `deploy` are manual buttons; the Devtron hand-off runs by itself on `main`.

## Documentation

| Read this | To |
|---|---|
| [Getting started](https://imbox.lol/docs/getting-started) | Install Imbox and connect your first mailbox |
| [Self-hosting](https://imbox.lol/docs/self-hosting) | Set up a production server, Docker, backups, and restore |
| [Updating](https://imbox.lol/docs/updating) | Update, run migrations, and roll back |
| [Configuration](https://imbox.lol/docs/configuration) | Every environment variable and setting, in one place |
| [Mailboxes](https://imbox.lol/docs/mailboxes) | Connect Gmail, Outlook, IMAP and domain mailboxes |
| [Stalwart](https://imbox.lol/docs/stalwart) | Run a mail server from the app |
| [Browser extension](https://imbox.lol/docs/extension) | Screener count on toolbar, quick triage, side panel, and notifications |
| [Desktop app](https://imbox.lol/docs/desktop) | Native desktop shell for macOS, Windows, and Linux |
| [Calendar](https://imbox.lol/docs/calendar) | Continuous calendar, Google sync, and RSVPs |
| [AI](https://imbox.lol/docs/ai) | The assistant, providers, memory, agents, privacy |
| [Agent mail](https://imbox.lol/docs/agent-mail) | Mailboxes and an API for outside AI agents |
| [API](https://imbox.lol/docs/api) | How the app and clients talk to the backend server |
| [Development](https://imbox.lol/docs/development) | Run it locally, architecture, and tests |
| [Design](https://imbox.lol/docs/design) | The look and the rules behind it |
| [Security](SECURITY.md) | Threat model, protection, and vulnerability reporting |

## Contributing

Bug reports, fixes and ideas are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) takes you from a clone to a merge request, and the [Code of Conduct](CODE_OF_CONDUCT.md) applies to everyone. For a security problem, see [SECURITY.md](SECURITY.md).

## Built with

Hono on Node.js with PostgreSQL. React 19, Vite, Tailwind v4 and shadcn/ui. Mail comes in over IMAP, through the Gmail and Microsoft Graph APIs, or, for a Stalwart server you run, straight from it.

## License

MIT. See [LICENSE](LICENSE). Imbox is an independent project, not affiliated with HEY, Basecamp or 37signals; see [NOTICE](NOTICE).
