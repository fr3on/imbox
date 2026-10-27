// Fast decisions with TypeSafe AI's Jev model. Jev is not a chat model: you give it a piece of state and typed questions (pick one of these, rate on this scale,
// yes or no) and it answers with the value and how sure it is, in well under a second. imbox uses it for small calls it makes about mail: is this phishing, and
// where should this new sender go. It is off until the owner adds a key and switches it on, each decision has its own switch, and every call is written to the AI
// usage record like any other.

import type { Env } from "../env";
import { now } from "../db";
import { fetchTimeout } from "../http";
import { getSessionSecret } from "../secrets";
import { readableExcerpt } from "@shared/readable";
import { htmlToText } from "../sanitize";
import type { AiBucket, AiSuggestion, Confidence, SenderFacts } from "./screener";
import { decryptSecret, encryptSecret } from "./crypto";

export const JEV_MODEL = "jev-latest";
const DEFAULT_URL = "https://api.typesafe.ai";
const CALL_MS = 15_000;
/** How many calls to Jev may be in flight at once for one batch of senders. */
const PARALLEL = 6;

/* ---------- the capabilities ---------- */

export type JevFeature = "phishing" | "screener" | "checks";

export interface JevCapability {
  id: JevFeature;
  label: string;
  /** What it decides. */
  decides: string;
  /** What leaves your server for it. */
  sees: string;
  /** When it runs. */
  runs: string;
}

export const JEV_CAPABILITIES: JevCapability[] = [
  {
    id: "phishing",
    label: "Check unknown senders for phishing",
    decides: "How likely a message is to be phishing, and how hard it pushes you to act. A likely one gets the warning banner.",
    sees: "The sender's name and address, the subject, the start of the message, where its links go, and what your mail server said about the sender.",
    runs: "When you open a message from someone you have not let in. Each message is checked once.",
  },
  {
    id: "screener",
    label: "Suggest where new senders go",
    decides: "Whether a new sender belongs in the Imbox, Feed, Receipts or screened out, whether they are a person, and how sure it is.",
    sees: "The sender's name and address, up to three subjects, a short snippet, and how you sorted other senders at the same company.",
    runs: "When new senders are waiting in the Screener. Each sender is judged once.",
  },
  {
    id: "checks",
    label: "Quick checks on a message you pick",
    decides: "Seven quick questions about one message: how likely it is phishing, how hard it pushes, whether it needs a reply, whether it has a deadline, whether a person wrote it, where it belongs, and its tone.",
    sees: "The sender's name and address, the subject, the start of the message, where its links go, and what your mail server said about the sender.",
    runs: "Only when you choose \u201cCheck with Jev\u201d in a message's More menu.",
  },
];

/* ---------- the call ---------- */

export class JevError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function friendly(status: number, body: string): string {
  if (status === 401) return "TypeSafe did not accept that key. Check it in the TypeSafe console.";
  if (status === 422) return `TypeSafe could not read the question${body ? `: ${body.slice(0, 160)}` : ""}.`;
  if (status === 429) return "TypeSafe says there were too many requests. Try again in a minute.";
  if (status === 529) return "TypeSafe is overloaded right now. Try again in a moment.";
  return `TypeSafe answered ${status}${body ? `: ${body.slice(0, 160)}` : ""}.`;
}

export type Question =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export interface JevResult {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
  ms: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One call to Jev: the state, and the questions to answer about it. Throws a JevError that says what to do. */
export async function jevAsk(env: Pick<Env, "TYPESAFE_API_URL">, key: string, state: unknown, questions: Record<string, Question>): Promise<JevResult> {
  const base = (env.TYPESAFE_API_URL || DEFAULT_URL).replace(/\/+$/, "");
  const started = Date.now();
  let res: Response;
  try {
    // Asked for uncompressed on purpose: on the server every outbound request goes through the guarded agent in server/egress.mjs, and an answer that arrives
    // gzipped through it is not unpacked, so it would reach this code as bytes.
    res = await fetchTimeout(`${base}/v1/systemone`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json", "accept-encoding": "identity" }, body: JSON.stringify({ state, model: JEV_MODEL, questions }) }, CALL_MS);
  } catch (e) {
    throw new JevError(0, `Could not reach TypeSafe: ${((e as Error).message ?? "").slice(0, 120)}`);
  }
  if (!res.ok) throw new JevError(res.status, friendly(res.status, (await res.text().catch(() => "")).trim()));
  const raw = await res.text().catch((e) => `unreadable: ${(e as Error).message}`);
  let j: { model?: string; answers?: Record<string, any>; usage?: { input_tokens?: number; output_tokens?: number } } | null = null;
  try {
    j = JSON.parse(raw);
  } catch {
    console.error("jev: an answer that is not JSON", res.status, res.headers.get("content-encoding"), `${raw.length} characters`);
  }
  if (!j?.answers || typeof j.answers !== "object") {
    console.error("jev: an answer in an unknown shape", JSON.stringify(j).slice(0, 300));
    throw new JevError(502, "TypeSafe answered in a shape imbox does not know.");
  }
  const answers: Record<string, Answer> = {};
  for (const [k, a] of Object.entries(j.answers)) {
    if (a?.type === "noul") answers[k] = { type: "noul", noul: num(a.noul) };
    else if (a?.type === "choice" && typeof a.choice === "string") answers[k] = { type: "choice", choice: a.choice, confidence: num(a.confidence), probabilities: a.probabilities ?? {} };
    else if (a?.type === "score") answers[k] = { type: "score", score: num(a.score), confidence: num(a.confidence), probabilities: a.probabilities ?? {} };
  }
  return { model: j.model || JEV_MODEL, answers, usage: { input_tokens: num(j.usage?.input_tokens), output_tokens: num(j.usage?.output_tokens) }, ms: Date.now() - started };
}

/** Jev's confidence in the three steps the rest of imbox uses. Its own guide says above 0.9 is safe to act on, below 0.5 to leave to a person. */
export const confidenceLevel = (c: number): Confidence => (c >= 0.9 ? "high" : c >= 0.5 ? "medium" : "low");

/* ---------- settings ---------- */

export interface JevState {
  enabled: boolean;
  key: string;
  hint: string;
  features: Partial<Record<JevFeature, boolean>>;
}

function parseFeatures(s: string | null | undefined): JevState["features"] {
  try {
    const j = JSON.parse(s || "{}");
    return j && typeof j === "object" ? Object.fromEntries(JEV_CAPABILITIES.map((c) => [c.id, j[c.id] !== false ? undefined : false])) : {};
  } catch {
    return {};
  }
}

export async function loadJev(env: Env, userId: string): Promise<JevState> {
  const row = await env.DB.prepare(`SELECT key_enc, key_hint, enabled, features FROM jev_settings WHERE user_id = ?`).bind(userId).first<{ key_enc: string; key_hint: string; enabled: number; features: string }>();
  if (!row) return { enabled: false, key: "", hint: "", features: {} };
  let key = "";
  if (row.key_enc) {
    try {
      key = await decryptSecret(await getSessionSecret(env), row.key_enc);
    } catch {
      key = "";
    }
  }
  return { enabled: !!row.enabled && !!key, key, hint: row.key_hint, features: parseFeatures(row.features) };
}

// The Screener asks every time it is opened, and nearly everyone has Jev off. A short memory of the answer spares a read each time; saving the settings forgets it
// at once on this server, and another server process sees a change within the minute.
const remembered = new Map<string, { at: number; state: JevState }>();
const REMEMBER_MS = 30_000;

/** The key to use for one decision, or null when Jev is off, has no key, or this decision was switched off. */
export async function jevKeyFor(env: Env, userId: string, feature: JevFeature): Promise<string | null> {
  const hit = remembered.get(userId);
  let s = hit && Date.now() - hit.at < REMEMBER_MS ? hit.state : null;
  if (!s) {
    s = await loadJev(env, userId);
    if (remembered.size > 2000) remembered.clear();
    remembered.set(userId, { at: Date.now(), state: s });
  }
  return s.enabled && s.features[feature] !== false ? s.key : null;
}

export async function saveJev(env: Env, userId: string, patch: { enabled?: boolean; apiKey?: string | null; features?: Partial<Record<JevFeature, boolean>> }): Promise<void> {
  const cur = await env.DB.prepare(`SELECT key_enc, key_hint, enabled, features FROM jev_settings WHERE user_id = ?`).bind(userId).first<{ key_enc: string; key_hint: string; enabled: number; features: string }>();
  let enc = cur?.key_enc ?? "";
  let hint = cur?.key_hint ?? "";
  if (patch.apiKey === null) {
    enc = "";
    hint = "";
  } else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    const k = patch.apiKey.trim();
    enc = await encryptSecret(await getSessionSecret(env), k);
    hint = k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••";
  }
  const features = { ...(JSON.parse(cur?.features || "{}") as Record<string, boolean>), ...(patch.features ?? {}) };
  const enabled = enc ? (patch.enabled ?? !!cur?.enabled) : false;
  remembered.delete(userId);
  await env.DB
    .prepare(
      `INSERT INTO jev_settings (user_id, key_enc, key_hint, enabled, features, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET key_enc = excluded.key_enc, key_hint = excluded.key_hint, enabled = excluded.enabled, features = excluded.features, updated_at = excluded.updated_at`
    )
    .bind(userId, enc, hint, enabled ? 1 : 0, JSON.stringify(features), now())
    .run();
}

/** Every call is written to the AI usage record, so it shows on the AI Usage page beside the others. Never throws. */
export async function recordJevCall(db: Db, userId: string, feature: string, r: { model: string; usage: { input_tokens: number; output_tokens: number }; ms: number } | null, ms = 0): Promise<void> {
  try {
    await db
      .prepare(`INSERT INTO ai_calls (id, user_id, feature, model, input_tokens, output_tokens, estimated, ms, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, feature, r?.model ?? JEV_MODEL, r?.usage.input_tokens ?? 0, r?.usage.output_tokens ?? 0, r?.ms ?? ms, r ? 1 : 0, now())
      .run();
  } catch {
    /* the usage record must never fail a decision */
  }
}

/** How many times each decision was made in the last 30 days, and when it last was. */
export async function jevUsage(db: Db, userId: string): Promise<Record<JevFeature, { calls: number; last: number | null }>> {
  const rows = await db
    .prepare(`SELECT feature, COUNT(*) AS calls, MAX(created_at) AS last FROM ai_calls WHERE user_id = ? AND feature IN ('jev_phishing', 'jev_screener', 'jev_checks') AND created_at >= ? GROUP BY feature`)
    .bind(userId, now() - 30 * 24 * 3600_000)
    .all<{ feature: string; calls: number; last: number | null }>();
  const out: Record<JevFeature, { calls: number; last: number | null }> = { phishing: { calls: 0, last: null }, screener: { calls: 0, last: null }, checks: { calls: 0, last: null } };
  for (const r of rows.results) {
    const id: JevFeature = r.feature === "jev_phishing" ? "phishing" : r.feature === "jev_checks" ? "checks" : "screener";
    out[id] = { calls: Number(r.calls), last: r.last == null ? null : Number(r.last) };
  }
  return out;
}

/* ---------- phishing ---------- */

const PHISHING_QUESTIONS: Record<string, Question> = {
  phishing: {
    type: "noul",
    instructions:
      "The message is a scam or phishing attempt: it tries to get the reader's password, payment details or personal information, or to get them to open a harmful link, usually by pretending to be a company, a person, or the reader's own email provider.",
  },
  pressure: {
    type: "score",
    instructions: "How hard the message pushes the reader to act right away",
    criteria: ["No pressure", "A mild deadline or a request", "Strong urgency, a threat, or a penalty for not acting"],
  },
};

export interface PhishingFacts {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  auth: string;
  toDomains: string[];
}

const linkHosts = (html: string): string[] => {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*["']https?:\/\/([^/"'?#:@]*(?:@[^/"'?#:]*)?)/gi;
  for (let m = re.exec(html); m && out.size < 8; m = re.exec(html)) out.add(m[1].toLowerCase());
  return [...out];
};

export interface PhishingVerdict {
  /** 0 to 1: how likely it is phishing. */
  probability: number;
  /** 0 to 1: how hard it pushes. */
  pressure: number;
  model: string;
  ms: number;
  usage: { input_tokens: number; output_tokens: number };
}

export async function jevPhishing(env: Env, key: string, f: PhishingFacts): Promise<PhishingVerdict> {
  const body = readableExcerpt(f.text || htmlToText(f.html), 1500);
  const r = await jevAsk(env, key, { from: { name: f.fromName, email: f.fromEmail }, reply_to: f.replyTo || undefined, sent_to_domains: f.toDomains, subject: f.subject, text: body, link_hosts: linkHosts(f.html), sender_verification: f.auth || undefined }, PHISHING_QUESTIONS);
  const p = r.answers.phishing;
  const s = r.answers.pressure;
  if (p?.type !== "noul") throw new JevError(502, "TypeSafe left out the answer imbox asked for.");
  return { probability: p.noul, pressure: s && s.type === "score" ? Math.min(1, Math.max(0, s.score / 2)) : 0, model: r.model, ms: r.ms, usage: r.usage };
}

/* ---------- quick checks on one message ---------- */

const CHECK_QUESTIONS: Record<string, Question> = {
  ...PHISHING_QUESTIONS,
  needs_reply: { type: "noul", instructions: "The sender expects a reply or an answer from the reader" },
  has_deadline: { type: "noul", instructions: "The message gives a deadline or a date by which something has to happen" },
  person: { type: "noul", instructions: "The sender is one individual human writing to the reader directly, not a company, a team or role mailbox, an automated system, a newsletter or marketing" },
  place: {
    type: "choice",
    instructions: "Where mail like this belongs",
    criteria: {
      imbox: "A person, or an organisation writing to the reader directly, about something that deserves their attention",
      feed: "A newsletter, marketing, a product update, a digest, or a social or community notification",
      paper_trail: "A receipt, invoice, order, shipping or booking confirmation, statement, or an account or security notice",
      screened_out: "Spam, cold sales outreach nobody asked for, phishing, or a lookalike sender",
    },
  },
  tone: {
    type: "choice",
    instructions: "The tone of the message",
    criteria: { friendly: "Warm, friendly or thankful", businesslike: "Plain and businesslike", pushy: "Demanding, pushy or threatening", upset: "Upset, angry or complaining" },
  },
};

export interface JevCheck {
  id: string;
  label: string;
  /** The answer in a word or two: "Likely", "Yes", "Updates". */
  text: string;
  /** How sure, or how much, from 0 to 100. */
  pct: number;
  /** Worth a second look. */
  flag: boolean;
}

export interface JevChecks {
  checks: JevCheck[];
  model: string;
  ms: number;
  usage: { input_tokens: number; output_tokens: number };
}

const PLACE_NAME: Record<string, string> = { imbox: "Imbox", feed: "Feed", paper_trail: "Receipts", screened_out: "Screened out" };
const TONE_NAME: Record<string, string> = { friendly: "Friendly", businesslike: "Businesslike", pushy: "Pushy", upset: "Upset" };
const yesNo = (p: number) => (p >= 0.7 ? "Yes" : p <= 0.3 ? "No" : "Maybe");

/** The questions of a quick check, all in one call, turned into rows a person can read. */
export async function jevThreadChecks(env: Env, key: string, f: PhishingFacts): Promise<JevChecks> {
  const body = readableExcerpt(f.text || htmlToText(f.html), 1500);
  const r = await jevAsk(env, key, { from: { name: f.fromName, email: f.fromEmail }, reply_to: f.replyTo || undefined, sent_to_domains: f.toDomains, subject: f.subject, text: body, link_hosts: linkHosts(f.html), sender_verification: f.auth || undefined }, CHECK_QUESTIONS);
  const a = r.answers;
  const noul = (id: string) => (a[id]?.type === "noul" ? (a[id] as { noul: number }).noul : null);
  const checks: JevCheck[] = [];
  const p = noul("phishing");
  if (p != null) checks.push({ id: "phishing", label: "Phishing", text: p >= 0.6 ? "Likely" : p >= 0.3 ? "Possible" : "Unlikely", pct: Math.round(p * 100), flag: p >= 0.6 });
  const pr = a.pressure;
  if (pr?.type === "score") checks.push({ id: "pressure", label: "Pressure to act", text: pr.score >= 1.4 ? "Strong" : pr.score >= 0.6 ? "Some" : "None", pct: Math.round((Math.min(2, Math.max(0, pr.score)) / 2) * 100), flag: pr.score >= 1.4 });
  for (const [id, label] of [["needs_reply", "Needs a reply"], ["has_deadline", "Has a deadline"], ["person", "Written by a person"]] as const) {
    const v = noul(id);
    if (v != null) checks.push({ id, label, text: yesNo(v), pct: Math.round(v * 100), flag: false });
  }
  const place = a.place;
  if (place?.type === "choice") checks.push({ id: "place", label: "Belongs in", text: PLACE_NAME[place.choice] ?? place.choice, pct: Math.round(place.confidence * 100), flag: place.choice === "screened_out" && place.confidence >= 0.6 });
  const tone = a.tone;
  if (tone?.type === "choice") checks.push({ id: "tone", label: "Tone", text: TONE_NAME[tone.choice] ?? tone.choice, pct: Math.round(tone.confidence * 100), flag: (tone.choice === "pushy" || tone.choice === "upset") && tone.confidence >= 0.6 });
  if (!checks.length) throw new JevError(502, "TypeSafe left out the answers imbox asked for.");
  return { checks, model: r.model, ms: r.ms, usage: r.usage };
}

/* ---------- the Screener ---------- */

const SCREENER_QUESTIONS: Record<string, Question> = {
  bucket: {
    type: "choice",
    instructions: "Where mail from this new sender should go",
    criteria: {
      imbox: "A real person, or an organisation writing to the reader directly, about something that deserves their attention",
      feed: "Newsletters, marketing, product updates, digests, social and community notifications",
      paper_trail: "Receipts, invoices, order, shipping and booking confirmations, statements, account and security notices",
      screened_out: "Spam, cold sales outreach nobody asked for, phishing, or lookalike senders",
    },
  },
  person: { type: "noul", instructions: "The sender is one individual human writing to the reader directly, not a company, a team or role mailbox, an automated system, a newsletter or marketing" },
};

const LOOKS_LIKE: Record<AiBucket, string> = {
  imbox: "Looks like mail from a person or a team",
  feed: "Looks like a newsletter or an update",
  paper_trail: "Looks like a receipt or a notice",
  screened_out: "Looks like unwanted mail",
};

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** What Jev makes of one waiting sender, in the shape the Screener already keeps. */
export async function jevSuggestOne(env: Env, key: string, s: SenderFacts, past: string[]): Promise<{ suggestion: AiSuggestion; result: JevResult }> {
  const result = await jevAsk(env, key, { sender: { name: clip(s.name, 60), email: s.email }, subjects: s.subjects.slice(0, 3).map((x) => clip(x, 120)), snippet: clip(s.snippet, 240), has_unsubscribe_link: s.unsubscribe, messages: s.messages, hint_from_simple_rules: s.rule_guess, how_the_reader_sorted_this_company_before: past.length ? past : undefined }, SCREENER_QUESTIONS);
  const b = result.answers.bucket;
  const person = result.answers.person;
  if (b?.type !== "choice" || !["imbox", "feed", "paper_trail", "screened_out"].includes(b.choice)) throw new JevError(502, "TypeSafe left out the answer imbox asked for.");
  const bucket = b.choice as AiBucket;
  const level = confidenceLevel(b.confidence);
  return { suggestion: { bucket, confidence: level, reason: `${LOOKS_LIKE[bucket]} (${Math.round(b.confidence * 100)}% sure)`, person: person?.type === "noul" && person.noul >= 0.7 }, result };
}

/** A batch of senders, a few calls at a time. A sender whose call fails is left out, never guessed. */
export async function jevSuggestForSenders(env: Env, userId: string, key: string, senders: SenderFacts[], pastFor: (email: string) => string[]): Promise<Map<string, AiSuggestion>> {
  const out = new Map<string, AiSuggestion>();
  let next = 0;
  let firstError: JevError | null = null;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= senders.length || (firstError && firstError.status === 401)) return;
      const s = senders[i];
      const started = Date.now();
      try {
        const { suggestion, result } = await jevSuggestOne(env, key, s, pastFor(s.email));
        out.set(s.email.toLowerCase(), suggestion);
        await recordJevCall(env.DB, userId, "jev_screener", result);
      } catch (e) {
        firstError ??= e instanceof JevError ? e : new JevError(0, (e as Error).message);
        await recordJevCall(env.DB, userId, "jev_screener", null, Date.now() - started);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, senders.length) }, worker));
  if (firstError && !out.size) throw firstError;
  return out;
}

/* ---------- showing what it can do ---------- */

const SAMPLE_PHISHING: PhishingFacts = {
  fromName: "0x200.com Support",
  fromEmail: "dana@mail-secure-notice.example",
  replyTo: "",
  subject: "Password Expiry Notice for you@0x200.com",
  text: "Dear user, the password to your email you@0x200.com is scheduled to expire in 4 days. To keep the same password, use the button below. Failure to update your password will lead to temporary blocking of your email account.",
  html: '<a href="https://login-0x200-keep.example/keep">Keep Same Password</a>',
  auth: "spf=fail dkim=none dmarc=fail",
  toDomains: ["0x200.com"],
};

const SAMPLE_SENDER: SenderFacts = { email: "hello@designnotes.example", name: "Design Notes Weekly", subjects: ["Issue 88: what makes a list feel calm", "Issue 87: quiet interfaces"], snippet: "This week: three small changes that make a long list easier to scan. Read online or unsubscribe below.", unsubscribe: true, messages: 2, rule_guess: "feed" };

export interface JevSample {
  id: JevFeature;
  label: string;
  /** What was asked, in a few words. */
  input: string;
  /** What Jev said, in a sentence. */
  output: string;
  ms: number;
  tokens: number;
}

/** Runs one invented example of each decision, so the owner can see what Jev answers and how fast. Nothing of theirs is sent. */
export async function jevSamples(env: Env, key: string): Promise<JevSample[]> {
  const [p, s] = await Promise.all([jevPhishing(env, key, SAMPLE_PHISHING), jevSuggestOne(env, key, SAMPLE_SENDER, [])]);
  return [
    { id: "phishing", label: "Phishing check", input: "A made-up “Password Expiry Notice” from an unrelated address", output: `${Math.round(p.probability * 100)}% likely phishing, pressure ${Math.round(p.pressure * 100)}%`, ms: p.ms, tokens: p.usage.input_tokens + p.usage.output_tokens },
    { id: "screener", label: "Screener suggestion", input: "A made-up weekly newsletter from a new sender", output: `${s.suggestion.reason}${s.suggestion.person ? ", a person" : ", not a person"}`, ms: s.result.ms, tokens: s.result.usage.input_tokens + s.result.usage.output_tokens },
  ];
}
