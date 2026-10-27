# Security

Imbox holds your mail, your mailbox passwords and the access tokens of connected Gmail and Outlook mailboxes, so it is built to protect them. This page says what is in place, what you must do yourself, and how to report a problem. The full version, with what is and is not encrypted, is [Security and encryption](https://imbox.lol/docs/security).

## Report a problem

Please do not open a public issue for a security problem. Use GitHub's **Report a vulnerability** on the repository's **Security** tab, or on GitLab open an issue and tick **This issue is confidential**, with no details of the flaw until we reply. Say what you found, how to repeat it, and what it could allow. We will answer and keep you informed until it is fixed.

## What protects you

**Signing in**
- Passwords are stored as salted PBKDF2-SHA256 hashes.
- Two-factor authentication (an authenticator app, with single-use recovery codes) and passkeys are available. The second-factor secret is stored encrypted.
- Failed password and second-factor attempts are counted per account, so guessing is slowed down.
- A session token is random, and only a hash of it is stored. Sessions expire after 30 days. Changing your password signs out your other sessions.
- The session cookie is HttpOnly and SameSite=Lax.

**Your data**
- Mailbox passwords, AI keys, sign-in app secrets, webhook secrets and second-factor secrets are stored encrypted with a key made from `SESSION_SECRET`.
- The access and refresh tokens of connected Gmail and Outlook mailboxes are stored encrypted the same way. Tokens saved before that was added are encrypted in the background by the once-a-minute job.
- The nightly backup is encrypted to a public key when `BACKUP_AGE_RECIPIENT` is set in `/etc/inbox/backup.env`, so the server holds nothing that can open it. Without it the backup is written as it is.
- Nothing is sent to an outside service unless you turn on a feature that needs it. Two things happen on their own: a check for new versions, and fetching the pictures of people who write to you. Both have a switch in **Settings → Preferences → Privacy**. The `/privacy` page of your own install lists every outside address it can contact.

**Reading mail safely**
- Tracking pixels are removed when mail arrives. Other remote images stay hidden until you show them.
- The HTML of a message is cleaned before it is shown. This includes the quoted text of a reply or forward. A message is shown in a sandboxed frame.
- Attachments are sent as downloads unless their type is known to be safe to show.
- Outgoing mail is checked so a recipient name or subject cannot inject headers or commands.

**The web app**
- A request that changes something must come from the app's own address. A page on another site cannot use your session.
- Responses carry a strict content security policy, frame protection, and the other standard security headers.
- Server-side requests to an address that someone else chose (a calendar link, a logo, a webhook) are refused if they point at your own network or at private addresses.

**AI**
- The AI only gets mail when you use a feature that needs it. Once the assistant has read mail, the code stops a message from steering it into sending to new people, changing many threads at once, or changing its memory of you.
- Agents work under limits that the code enforces. See [AI](https://imbox.lol/docs/ai#what-it-cannot-do).

## What you must do

- **Keep `SESSION_SECRET` safe and stable.** Back it up somewhere that is not the server. If it is lost or changed, stored passwords and keys cannot be read.
- **Turn on two-factor authentication** in Settings → Security.
- **Set `APP_URL` correctly.** It must be the exact public address with `https://`.
- **Protect the server.** Run `deploy/harden.sh`, limit SSH (port 22) to your own address in the cloud firewall, and keep the machine updated.
- **Back up the database**, encrypt the backups with `BACKUP_AGE_RECIPIENT`, and keep a copy off the server. Keep the private key off the server too. Backups hold your mail, so protect them like the server. See [Self-hosting](https://imbox.lol/docs/backups).
- **Rotate secrets that expire.** Microsoft client secrets expire. See [Mailboxes](https://imbox.lol/docs/mailboxes#outlook).
- **Update.** See [Updating](https://imbox.lol/docs/updating).

## What it does not do

- It does not check that a message really came from the address it shows. A sender can be forged, as in any mail program.
- It has one owner. It is not a multi-user service, and it has not been designed to hold other people's mail.
