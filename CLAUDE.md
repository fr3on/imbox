# Imbox

A calm, self-hosted email client with one owner. Mail from people comes first, new senders wait in the Screener, and AI only acts when asked. The package is named `imbox`; the repo and the GitHub project are `imbox` (`fr3on/imbox`). MIT licensed.

Read `DESIGN.md` before touching anything in `src/web`. The documentation and the public website (front page, features tour, privacy page) are in their own repository, `https://git.0x200.com/fr3on/imbox-website`; the docs are in its `docs/content/docs/` (start with `development.mdx`, `database.mdx`, `api.mdx`). Where this file says `imbox-website/docs/content/docs/X`, that is where to look.

## Stack

- **Server**: Hono on Node 22, PostgreSQL 16.
- **Web**: React 19, Vite, Tailwind v4, shadcn/ui (radix), react-router-dom 7, TanStack Query.
- **Language**: TypeScript strict. Biome for lint only; the formatter is off.
- **Other targets**: browser extension (`apps/extension`, plain JS), Tauri desktop shell (`apps/desktop`).

## Layout

```
src/web/       React client. DesktopApp.tsx and MobileApp.tsx are separate layouts.
  components/  shared UI; components/ui is shadcn
  pages/       desktop pages;  mobile/ has the phone screens
  api/         typed client calls and React Query hooks per resource
  lib/         pure helpers (shortcuts.ts is the single list of keyboard shortcuts)
src/api/       Hono backend. routes/ by resource, db.ts helpers, cron.ts 60s job loop,
               sync/imap/smtp/google/microsoft/stalwart mail transports, ai/ providers and tools
src/shared/    types and pure logic used by both sides (alias @shared)
src/node/      Node-only sockets (raw IMAP and SMTP)
server/        Node entry (run.mjs), PostgreSQL gateway, SQL translation, egress guard
migrations/    numbered SQL, registered in src/api/migrations.ts
test/          vitest; test/pg and test/node run separately
deploy/        setup, deploy, harden, backup scripts, Caddyfile
```

Path aliases: `@/` is `src/web`, `@shared/` is `src/shared`.

## Apps (`apps/`)

Two clients outside the main web app. Neither is type-checked or covered by Vitest, and only the extension is linted by Biome, so check changes by hand.

**`apps/extension`** - Manifest V3 browser extension for Chrome, Edge and Firefox. Plain JavaScript, no build step, no framework.
- Files: `background.js` (service worker: badge count, alarms, notifications, context menu), `popup.*` and `sidepanel.html` (UI), `options.*` (server URL and token), `connect.js`, `lib.js` (shared API and storage helpers), `style.css`.
- It talks to the server only with a scoped `imx_...` token, limited to the read and triage endpoints listed in `imbox-website/docs/content/docs/extension.mdx`. A new extension feature that needs another endpoint means widening that scope on the server on purpose, with a test; do not use the session cookie.
- Host permission is requested only for the user's own server. Do not add broad host permissions or content scripts.
- Same design rules as the web app: grayscale, no emoji, plain words (`DESIGN.md`), and the extension must work in light and dark.
- `npm run ext:pack` makes `imbox-extension.zip`. `scripts/pack-downloads.mjs` also packs it on every `dev` and `build` so the server can serve `/downloads/imbox-extension.zip`. Bump `manifest.json` version with a release.

**`apps/desktop`** - Tauri v2 shell (Rust in `src-tauri/`, a small server-address picker in `ui/`). It loads the user's own Imbox server live; the web client is not bundled into the binary.
- Native pieces only: Dock and taskbar unread count, system notifications, menu bar, default `mailto:` handling. Product behavior belongs in `src/web`, not here. `src/web/lib/native.ts` is the web side of the bridge.
- Build with `cd apps/desktop && npm ci && npx tauri build` (needs Node 22 and Rust); `cross/` holds the Linux Docker build. Details in `imbox-website/docs/content/docs/desktop.mdx`.
- Local builds are ad-hoc signed. Do not offer an unsigned build for download: `pack-downloads.mjs` only publishes installers named by `IMBOX_MAC_DMG`, `IMBOX_WIN_EXE` and the Linux variables.
- Keep the Tauri capabilities in `src-tauri/capabilities` minimal; adding a permission needs a reason.

## Commands

| Command | Use |
|---|---|
| `npm run check` | All four `tsc` projects (web, api, tests, web tests) |
| `npm run lint` | Biome. Errors fail CI; existing warnings are old code |
| `npm test` | Vitest in Node against a real PostgreSQL (`PG_TEST_URL`), one database per file, about 90s |
| `npm run build:node && npm run test:pg` | Server end-to-end tests. Run the build first: without it the e2e, cluster and events files are skipped, and an all-green run with 3 skipped files is not a pass |
| `npm run dev` | Vite on 5173, proxies `/api` and `/auth` to 8787 |
| `npm run start:selfhost` | Backend and static server on 8787 (after `build:node`) |
| `npm run gen:schema` | Regenerate `src/api/schema.ts` from migrations |
| `npm run inventory:sql` | SQL inventory used by the statement-budget checks |

Local database: `docker compose -f docker-compose.dev.yml up -d db` gives PostgreSQL on port 54329. `scripts/seed-demo.mjs` fills invented demo data.

## Rules for code

**Database**
- Plain PostgreSQL. Write `?` placeholders; the gateway translates to `$1, $2`. Use `ILIKE`, `ON CONFLICT`, `LEAST`/`GREATEST`.
- Migrations only add tables and columns. Never edit one that has merged or shipped. A new file is `migrations/00NN_name.sql`, then add its import and entry to `src/api/migrations.ts` (the bundle cannot read the directory), then run `npm run gen:schema`.
- Do not use `SELECT *` or `OFFSET` in list routes. Routes have statement budgets enforced by tests (`test/api/statement-budget.json`); a change that adds queries per request needs a justified budget change.
- Use `LOOKUP_CHUNK` and `chunk` from `src/api/db.ts` for large `IN (...)` lists.

**Routes and security**
- Every route that takes an id must check the row belongs to the signed-in user. `test/api/api-ownership.test.ts` and the route sweep catch misses.
- Validate input with Zod or `src/api/input.ts`. Bad input is a clean 400, never a 500.
- State-changing cookie requests are guarded by `src/api/security.ts` (Origin must match `APP_URL`). Do not bypass it.
- Outbound requests use `fetchTimeout` (`src/api/http.ts`) and the destination check in `netguard.ts` (SSRF). Do not call `fetch` directly for user-influenced URLs.
- Long work runs in the 60-second job in `cron.ts` (`runJob`), never inside an HTTP request.
- `SESSION_SECRET` encrypts stored secrets. Do not log, rotate or change how it is used without a migration plan.
- Auth kinds: session cookie, scoped extension tokens (`imx_...`), agent mailbox keys. Keep their scopes narrow.

**Web**
- Use `components/ui` primitives. Never hand-roll a button, input, dialog or tooltip. Add shadcn parts with `npx shadcn@latest add <name>`.
- Desktop and phone are separate screens. A change to a list or flow usually needs both `src/web/pages` and `src/web/mobile`.
- Every keyboard shortcut goes in `src/web/lib/shortcuts.ts`; the cheat sheet reads it. The website keeps a copy for its features tour (`src/lib/shortcuts.ts` there), so copy changes across.
- Everything visual follows `DESIGN.md`: grayscale, no emoji, lucide icons, plain words.

**Style**
- Match the surrounding code: naming, comment density, level of detail. Comments say why, not what, in plain words. Do not reformat lines you did not change.
- No new dependency without a reason you can state in one sentence.
- User-visible text is short and plain. No exclamation marks.
- Test and doc data is invented: Maya Chen, `example.com`. Never real mail or real addresses.
- No emoji or symbol glyphs anywhere: UI, docs, commit messages, design mockups. Use lucide or inline SVG line icons.

## Tests

- Add or update a test when behavior changes. Tests live in `test/`, shaped like their neighbors; helpers are `test/api-harness.ts`, `api-world.ts`, `helpers.ts`, `support/`.
- Tests run in plain Node against real PostgreSQL through the same gateway and SQL translation the server uses, so what passes is what runs. `test/pg` and `test/node` run apart under `vitest.pg.config.ts`.
- Before calling work done: `npm run check`, `npm run lint`, `npm test`, and for server, migration or database changes `npm run build:node && npm run test:pg`.

## Releases

Tag-driven; see `imbox-website/docs/content/docs/releasing.mdx` and `npm run release:check`. Version lives in `package.json` and is mirrored by `scripts/version.mjs`. CHANGELOG.md is updated for user-visible changes.
