# Contributing to Imbox

Thank you for wanting to help. This page gets you from a fresh clone to a pull request. If something here is wrong or takes longer than fifteen minutes, that is a bug in this page: please tell us.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For a security problem, do not open an issue: follow [SECURITY.md](SECURITY.md).

## Before you start

- **Small fixes** (a typo, a clear bug, a missing test): open a pull request.
- **Anything bigger** (a feature, a change to how something works, a new dependency): open an issue first and say what you want to do. It saves you from writing something we cannot take, and the answer is usually quick.
- **Questions**: look in the [docs](https://imbox.lol/docs) first, then open an issue. There is a page for [development](https://imbox.lol/docs/development), [configuration](https://imbox.lol/docs/configuration), [mailboxes](https://imbox.lol/docs/mailboxes) and more.

## Set it up

You need Node 22, Docker (for PostgreSQL) and git.

```sh
git clone https://github.com/<your-fork>/imbox.git && cd imbox     # or your GitLab fork
npm ci
docker compose -f docker-compose.dev.yml up -d db       # PostgreSQL on port 54329
npm test                                                 # about 90 seconds
```

To run the app itself, follow [Run it locally](https://imbox.lol/docs/development#run-it-locally).

## Make a change

1. Branch from `main`: `git switch -c fix-the-thing`.
2. Make the change. Keep it focused: one thing per pull request.
3. Run what CI runs:

   ```sh
   npm run check      # types, for the web app, the server and the tests
   npm run lint       # Biome. It fails on errors; the warnings are older code
   npm test           # the tests, in Node against PostgreSQL
   npm run build:node && npm run test:pg    # also, if you touched the server, a migration or the database
   ```

4. Add or update a test when behaviour changes. Tests live in `test/`, one database per file, and read like the code around them. [Rules for changes](https://imbox.lol/docs/development#rules-for-changes) lists what a change to routes, the database and the web app has to respect, such as checking that an id belongs to the signed-in user.
5. Commit with a sign-off (below) and a message that says what changed and why.
6. Open a pull request (a merge request on GitLab) against `main`. Fill in the template. CI runs the type check, the linter and the tests; it has to be green before anyone reviews.

## Sign your commits (DCO)

Every commit needs a `Signed-off-by` line. It says you wrote the change, or have the right to give it to the project, under the project's licence (MIT). It is the [Developer Certificate of Origin](https://developercertificate.org/), and you add it with:

```sh
git commit -s -m "Fix the thing"
```

That adds `Signed-off-by: Your Name <you@example.com>` using your git name and email. There is nothing to sign and no agreement to send. If you forgot, `git commit --amend -s` for the last commit, or `git rebase --signoff main` for a branch.

## Style

- Match the code around the change: its naming, its comments, its level of detail. We do not run an automatic formatter yet, so do not reformat lines you did not change.
- Comments say why, not what. Write plain words. Prefer a short sentence to a clever one.
- No new dependency without a reason that fits in the pull request description.
- User-visible text is plain and short.
- Invented data only. Use made-up people (the demo uses Maya Chen) and `example.com` addresses in tests, screenshots and docs. Never real mail.

## Migrations

A change to the database is a new numbered file in `migrations/`, registered in `src/api/migrations.ts`. Never edit one that has shipped. If it builds an index on a large table, say so in the description, since it runs on the first start of the new version.

## How review works

One maintainer reviews. We answer as soon as we can. We may ask for changes, or say no to something that does not fit the direction of the project; we will say why. Small, focused pull requests with a test are merged fastest.

## Licence

Imbox is released under the [MIT licence](LICENSE). Your contribution is under the same licence.
