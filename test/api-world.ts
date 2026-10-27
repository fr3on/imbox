import { call, json, nid, seedAccount, seedThread, signIn, testEnv } from "./api-harness";
import { seedAgent, seedKey, seedMessage } from "./agent-fixtures";
import { encryptSecret } from "../src/api/ai/crypto";
import { getSessionSecret } from "../src/api/secrets";

/**
 * One user's data, a little of every kind, so a route that takes an id has a real id to be given. Built mostly through the API itself
 * (so what is created is what the app would create) and straight into the tables only where there is no route to make the thing.
 */
export interface World {
  user: string;
  token: string;
  gmail: string;
  imap: string;
  agentAccount: string;
  domainAccount: string;
  thread: string;
  message: string;
  attachment: string;
  label: string;
  collection: string;
  clip: string;
  draft: string;
  bundle: string;
  contact: string;
  domain: string;
  stalwart: string;
  passkey: string;
  letIn: string;
  calendar: string;
  event: string;
  cover: string;
  conversation: string;
  memory: string;
  autoAgent: string;
  autoMemory: string;
  agentKey: string;
  agentKeyPlain: string;
  agentMessage: string;
}

const db = () => testEnv.DB;
const ok = async (res: Response, what: string) => {
  if (res.status >= 300) throw new Error(`seeding ${what}: ${res.status} ${await res.text()}`);
  return json(res);
};

export async function seedWorld(user: string): Promise<World> {
  const token = await signIn(user);
  const t = Date.now();
  const gmail = `${user}-gmail`;
  const imap = `${user}-imap`;
  const agentAccount = `${user}-agent`;
  const domainAccount = `${user}-dom`;
  await seedAccount(gmail, `${user}@gmail.test`, { user, provider: "gmail" });
  await seedAccount(imap, `${user}@imap.test`, { user, provider: "imap" });
  await seedAccount(agentAccount, `${user}-bot@imap.test`, { user, provider: "imap" });
  for (const id of [imap, agentAccount]) {
    await db()
      .prepare(`INSERT INTO imap_accounts (account_id, imap_host, smtp_host, username, password_enc, folder, updated_at) VALUES (?, 'imap.test', 'smtp.test', 'u', 'x', 'INBOX', ?)`)
      .bind(id, t)
      .run();
  }
  await seedAgent(agentAccount);
  const agentKeyPlain = await seedKey(agentAccount, { id: `${user}-key`, scopes: "read,send" });
  const agentMessage = `${user}-agent-msg`;
  await seedMessage(agentAccount, { id: agentMessage, date: t - 1000, subject: `Agent mail of ${user}` });

  const domain = `${user}-domain`;
  await db().prepare(`INSERT INTO domains (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(domain, user, `${user}.example.org`, t, t).run();
  await seedAccount(domainAccount, `hi@${user}.example.org`, { user, provider: "domain" });
  await db().prepare(`UPDATE accounts SET domain_id = ? WHERE id = ?`).bind(domain, domainAccount).run();

  const stalwart = `${user}-stalwart`;
  await db().prepare(`INSERT INTO stalwart_servers (id, user_id, name, base_url, imap_host, smtp_host, api_key_enc, created_at) VALUES (?, ?, 'S', 'https://mail.example.org', 'mail.example.org', 'mail.example.org', ?, ?)`).bind(stalwart, user, await encryptSecret(await getSessionSecret(testEnv), "stalwart-api-key"), t).run();

  const { thread, message } = await seedThread(gmail, { subject: `Mail of ${user}` });
  const attachment = nid("att");
  await db().prepare(`INSERT INTO attachments (id, account_id, message_id, thread_id, gmail_attachment_id, filename, mime_type, size, is_inline, created_at) VALUES (?, ?, ?, ?, 'ga', 'a.txt', 'text/plain', 3, 0, ?)`).bind(attachment, imap, message, thread, t).run();
  // The attachment row says "imap" account; point the message at the same account so the join in the proxy lines up.
  await db().prepare(`UPDATE messages SET account_id = ? WHERE id = ?`).bind(imap, message).run();
  await db().prepare(`UPDATE threads SET account_id = ? WHERE id = ?`).bind(imap, thread).run();
  await db().prepare(`INSERT INTO attachment_blobs (attachment_id, data, created_at) VALUES (?, ?, ?)`).bind(attachment, new Uint8Array([104, 105, 33]), t).run();

  const contact = nid("c");
  await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, message_count, notes) VALUES (?, ?, ?, 'Sender', 'imbox', ?, ?, 1, '')`).bind(contact, imap, "sender@example.com", t, t).run();
  const bundle = nid("b");
  await db().prepare(`INSERT INTO bundles (id, account_id, contact_id, email, status, thread_count, message_count, first_message_at, last_message_at, created_at) VALUES (?, ?, ?, 'sender@example.com', 'open', 0, 0, ?, ?, ?)`).bind(bundle, imap, contact, t, t, t).run();
  const passkey = nid("pk");
  await db().prepare(`INSERT INTO passkeys (id, user_id, name, public_key, created_at) VALUES (?, ?, 'Laptop', 'AAAA', ?)`).bind(passkey, user, t).run();
  const letIn = nid("li");
  await db().prepare(`INSERT INTO auto_let_ins (id, user_id, email, name, reason, created_at) VALUES (?, ?, 'sender@example.com', 'Sender', 'because', ?)`).bind(letIn, user, t).run();

  const a = { token, headers: { "x-account-id": imap } };
  void a;
  const label = (await ok(await call("POST", "/api/labels", { token, body: { name: `L-${user}`, account_id: imap } }), "label")).id;
  const collection = (await ok(await call("POST", "/api/collections", { token, body: { name: `C-${user}`, account_id: imap } }), "collection")).id;
  const clip = (await ok(await call("POST", "/api/clips", { token, body: { thread_id: thread, text: `worth keeping ${user}` } }), "clip")).id;
  const draft = (await ok(await call("POST", "/api/drafts", { token, body: { account_id: imap, subject: "draft", to: ["a@b.co"] } }), "draft")).id;
  const calendar = (await ok(await call("POST", "/api/calendar/sources", { token, body: { name: `Cal-${user}` } }), "calendar")).id;
  const event = (await ok(await call("POST", "/api/calendar/events", { token, body: { calendar_id: calendar, title: `Lunch ${user}`, starts_at: t + 86_400_000, ends_at: t + 90_000_000 } }), "event")).id;
  const cover = (await ok(await call("POST", "/api/calendar/covers", { token, raw: "png-bytes", headers: { "content-type": "image/png" } }), "cover")).id;
  const conversation = (await ok(await call("POST", "/api/ai/conversations", { token, body: {} }), "conversation")).id;
  const memory = (await ok(await call("POST", "/api/ai/memory", { token, body: { content: `I prefer short answers ${user}`, kind: "tone" } }), "memory")).id;
  const autoAgent = (await ok(await call("POST", "/api/auto-agents", { token, body: { name: `Bot-${user}`, account_ids: [] } }), "auto agent")).id;
  const autoMemory = (await ok(await call("POST", `/api/auto-agents/${autoAgent}/memory`, { token, body: { content: `Never promise a date ${user}` } }), "auto agent memory")).id;

  return {
    user, token, gmail, imap, agentAccount, domainAccount, thread, message, attachment, label, collection, clip, draft, bundle, contact, domain, stalwart,
    passkey, letIn, calendar, event, cover, conversation, memory, autoAgent, autoMemory, agentKey: `${user}-key`, agentKeyPlain, agentMessage,
  };
}

/** Fill a route template's parameters with this world's real ids. Templates are the paths in the route files, mounted. */
export function fill(template: string, w: World): string {
  const byName: Record<string, string> = {
    id: "", accountId: "", attId: w.attachment, aid: w.attachment, keyId: w.agentKey, mid: w.autoMemory, sid: "sid", did: "did",
    threadId: w.thread, provider: "google", hash: "0".repeat(64), domain: "example.com", date: "2030-01-01", key: "abcd1234", file: `${w.event}.ics`,
  };
  const first = template.replace(/^\/(api|agent\/v1)/, "").split("/")[1] ?? "";
  const idByRoot: Record<string, string> = {
    threads: w.thread, messages: w.message, labels: w.label, collections: w.collection, clips: w.clip, drafts: w.draft, bundles: w.bundle, contacts: w.contact,
    accounts: w.imap, domains: w.domain, stalwart: w.stalwart, agents: w.agentAccount, "auto-agents": w.autoAgent, passkeys: w.passkey, conversations: w.conversation,
  };
  const sub = template.split("/");
  const second = sub[3] ?? "";
  const idFor = (): string => {
    if (first === "calendar") {
      if (second === "events") return w.event;
      if (second === "sources") return w.calendar;
      if (second === "covers") return w.cover;
      return w.event;
    }
    if (first === "ai") return second === "conversations" ? w.conversation : second === "memory" ? w.memory : w.thread;
    if (first === "me") return w.passkey;
    if (first === "screener") return w.letIn;
    return idByRoot[first] ?? "x";
  };
  return template.replace(/:([A-Za-z]+)(\{[^}]*\})?/g, (_, name: string) => {
    if (name === "id" || name === "accountId") {
      if (first === "agents" || first === "calendar" && name === "accountId") return name === "accountId" && first === "calendar" ? w.gmail : w.agentAccount;
      return idFor();
    }
    return byName[name] ?? "x";
  });
}
