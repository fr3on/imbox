#!/usr/bin/env node
// Fills a Postgres database with a small, made-up mailbox so the app can be photographed (README screenshots) without anyone's real mail.
// Start the server against an empty database, create the owner at /signup, then:
//   DATABASE_URL=postgres://... node scripts/seed-demo.mjs
// Every name, address and message below is invented. Times are relative to now, so re-run it before taking pictures.
import crypto from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
const uid = () => crypto.randomUUID();
const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => now - ms;
/** A preview line that ends on a whole word, like a real mail client's. */
const snip = (text) => (text.length > 110 ? `${text.slice(0, text.lastIndexOf(" ", 110))}…` : text);


// Invented company marks, so the demo shows logos the way the real app does for senders like Google or a hosting provider.
const MARKS = {
  rays: '<circle cx="20" cy="20" r="6" fill="#fff"/><g stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M20 6v4M20 30v4M6 20h4M30 20h4M10 10l3 3M27 27l3 3M30 10l-3 3M13 27l-3 3"/></g>',
  notes: '<g fill="#fff"><rect x="10" y="11" width="20" height="3.2" rx="1.6"/><rect x="10" y="18.4" width="20" height="3.2" rx="1.6"/><rect x="10" y="25.8" width="12" height="3.2" rx="1.6"/></g>',
  nib: '<path d="M20 8l8 14-8 10-8-10z" fill="#fff"/><path d="M20 16v10" stroke="BG" stroke-width="2" stroke-linecap="round"/>',
  anchor: '<g stroke="#fff" stroke-width="2.8" stroke-linecap="round" fill="none"><circle cx="20" cy="12" r="3"/><path d="M20 15v17M13 21h14M11 25c1 5 5 7 9 7s8-2 9-7"/></g>',
  kite: '<path d="M20 7l9 11-9 15-9-15z" fill="#fff"/><path d="M11 18h18" stroke="BG" stroke-width="2"/>',
  stack: '<path d="M20 9l12 6-12 6-12-6z" fill="#fff"/><path d="M8 21l12 6 12-6M8 27l12 6 12-6" stroke="#fff" stroke-width="3" fill="none" stroke-linejoin="round"/>',
  cloud: '<path d="M13 28a5 5 0 0 1 .5-10A7 7 0 0 1 27 16a6 6 0 0 1 .5 12z" fill="#fff"/>',
  moon: '<path d="M26 27a10 10 0 1 1-8-18 8 8 0 0 0 8 18z" fill="#fff"/>',
  bolt: '<path d="M22 6L11 23h8l-2 11 12-18h-8z" fill="#fff"/>',
  box: '<path d="M20 7l12 6v14l-12 6-12-6V13z" fill="none" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/><path d="M8 13l12 6 12-6M20 19v14" stroke="#fff" stroke-width="2.8" fill="none" stroke-linejoin="round"/>',
  plane: '<path d="M33 8L8 18l9 4 4 9z" fill="#fff"/>',
  leaf: '<path d="M10 30C10 16 18 9 31 9c0 13-7 21-21 21z" fill="#fff"/><path d="M12 28C17 22 22 18 26 14" stroke="BG" stroke-width="2" fill="none"/>',
};
const LOGOS = {
  "hannah@lumenworks.example": ["#5b5bd6", "rays"],
  "ravi@fieldnotes.example": ["#2f9e6b", "notes"],
  "tessa@quillpress.example": ["#d6336c", "nib"],
  "omar@harborcap.example": ["#e8590c", "anchor"],
  "hello@weeklybuild.example": ["#3b3b8f", "stack"],
  "editor@fieldnotes.example": ["#2f9e6b", "notes"],
  "news@kitedesign.example": ["#0c8599", "kite"],
  "team@morningbrief.example": ["#f08c00", "rays"],
  "hi@postcardweekly.example": ["#1971c2", "plane"],
  "letters@fernand.example": ["#37b24d", "leaf"],
  "bookings@northwindair.example": ["#1864ab", "plane"],
  "billing@cloudbox.example": ["#4263eb", "cloud"],
  "reservations@brasserielune.example": ["#862e9c", "moon"],
  "no-reply@citypower.example": ["#f59f00", "bolt"],
  "updates@parcelpoint.example": ["#a0522d", "box"],
};
function logoFor(email) {
  const l = LOGOS[email];
  if (!l) return "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${l[0]}"/>${MARKS[l[1]].replaceAll("BG", l[0])}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const user = (await pool.query("SELECT id FROM users LIMIT 1")).rows[0];
if (!user) {
  console.error("No owner yet: open the app and finish /signup first");
  process.exit(1);
}

const ME = { email: "maya@northwind.example", name: "Maya Chen" };
const accountId = "demo-account";

await pool.query("BEGIN");
await pool.query("SET LOCAL session_replication_role = replica");
for (const t of ["messages", "threads", "contacts", "events", "calendars", "accounts", "labels", "thread_labels", "attachments", "daily_briefs", "thread_actions", "drafts", "updates_digests", "thread_catchups", "thread_summaries", "screener_suggestions", "ai_calls"]) await pool.query(`DELETE FROM ${t}`);

await pool.query(
  `INSERT INTO accounts (id, user_id, provider, email, display_name, initial_sync_done, sync_status, last_synced_at, created_at) VALUES ($1,$2,'imap',$3,$4,1,'idle',$5,$5)`,
  [accountId, user.id, ME.email, ME.name, ago(2 * MIN)],
);

/** bucket: imbox | feed | paper_trail | screener. `seen` false puts it under "New for you". */
const threads = [
  // People (Imbox)
  { from: ["Daniel Okafor", "daniel@brightloop.example"], subject: "Lunch on Thursday?", body: "Are you free Thursday around 12:30? The new place on Harbour Street has a table for four and I would like you to meet Priya before the review.", bucket: "imbox", age: 12 * MIN, seen: false, count: 3 },
  { from: ["Priya Raman", "priya@brightloop.example"], subject: "Draft of the Q4 plan, comments welcome", body: "Attached is the first draft. The roadmap section is the one I am least sure about; could you look at pages 4 to 6 before Friday?", bucket: "imbox", age: 47 * MIN, seen: false, count: 2, attach: true },
  { from: ["Elena Petrova", "elena@petrova.example"], subject: "Photos from the weekend", body: "Finally sorted the photos from the lake. The one of you trying to launch the kayak is my favourite. Sending the full album as a link.", bucket: "imbox", age: 3 * HOUR, seen: false, count: 1 },
  { from: ["Marcus Hale", "marcus@hale-studio.example"], subject: "Re: Brand refresh, second round", body: "Thanks for the notes. I have folded them into version two and simplified the wordmark as you suggested. Two directions attached; I lean towards B.", bucket: "imbox", age: 5 * HOUR, seen: false, count: 6, attach: true },
  { from: ["Sofia Alvarez", "sofia@northwind.example"], subject: "Offsite agenda", body: "Draft agenda for the offsite is below. Please add anything I missed and tell me if the Wednesday dinner clashes with your travel.", bucket: "imbox", age: 1 * DAY + 2 * HOUR, seen: true, count: 4 },
  { from: ["Tom Whitfield", "tom@whitfield.example"], subject: "Flat viewing, Saturday 11am", body: "The agent confirmed Saturday at 11. It is the second floor, so bring a coat, the hallway is cold. I will send the exact address tomorrow.", bucket: "imbox", age: 1 * DAY + 6 * HOUR, seen: true, count: 2, setAside: true },
  { from: ["Aiko Tanaka", "aiko@tanaka.example"], subject: "Recommendation for the design lead role", body: "Happy to write it. Could you send me two or three lines on what you would want emphasised, and the deadline?", bucket: "imbox", age: 2 * DAY, seen: true, count: 5, replyLater: true },
  { from: ["Noah Bennett", "noah@bennett.example"], subject: "Book you asked about", body: "It is called The Timeless Way of Building. I have my copy here, you are welcome to borrow it next time you are over.", bucket: "imbox", age: 3 * DAY, seen: true, count: 1, setAside: true },
  { from: ["Grace Mwangi", "grace@northwind.example"], subject: "Invoice question", body: "Quick one: the November hosting invoice shows two lines for the same service. Is that intended or should I ask them to correct it?", bucket: "imbox", age: 4 * DAY, seen: true, count: 3, replyLater: true },
  { from: ["Lucas Ferreira", "lucas@ferreira.example"], subject: "Notes from the customer call", body: "Notes are in the shared folder. Three themes came up: onboarding time, the export format, and price. I will draft a summary tomorrow.", bucket: "imbox", age: 5 * DAY, seen: true, count: 2, setAside: true },

  // Waiting in the Screener
  { from: ["Hannah Cole", "hannah@lumenworks.example"], subject: "Introduction from Daniel", body: "Daniel suggested I get in touch. I run partnerships at Lumenworks and we are looking at a small pilot with teams like yours.", bucket: "screener", age: 2 * HOUR, seen: false, count: 1 },
  { from: ["Ravi Shah", "ravi@fieldnotes.example"], subject: "Would you speak at our meetup?", body: "We host a monthly evening for about sixty product people. Would you be open to a 20 minute talk in March?", bucket: "screener", age: 9 * HOUR, seen: false, count: 1 },
  { from: ["Tessa Morgan", "tessa@quillpress.example"], subject: "Review copy of our new book", body: "We are sending review copies of Small Systems, a book about running calm software teams. May I post you one?", bucket: "screener", age: 1 * DAY, seen: false, count: 1 },
  { from: ["Omar Haddad", "omar@harborcap.example"], subject: "Quick question about your stack", body: "I am researching how small teams choose their tools and saw your name on a talk. Ten minutes on a call this week?", bucket: "screener", age: 2 * DAY, seen: false, count: 1 },
  { from: ["Design Notes Weekly", "digest@designnotes.example"], subject: "Issue 88: what makes a list feel calm", body: "This week: three teams that cut their navigation in half, and why empty states deserve a designer.", bucket: "screener", age: 5 * HOUR, seen: false, count: 1, unsub: true },
  { from: ["Launch List", "hello@launchlist.example"], subject: "Ten tools launching this week", body: "A short list of new products worth a look, with one line on what each is for and who it is for.", bucket: "screener", age: 14 * HOUR, seen: false, count: 1, unsub: true },
  { from: ["The Commons", "editor@thecommons.example"], subject: "Why small teams ship calmer", body: "A long read on meeting-free weeks, written handoffs and the quiet advantage of being small.", bucket: "screener", age: 1 * DAY + 3 * HOUR, seen: false, count: 1, unsub: true },
  { from: ["Hearth Coffee", "orders@hearthcoffee.example"], subject: "Your receipt from Hearth Coffee", body: "Thanks for your order of two bags of the Sunday roast. Your total was 27.50 and it ships tomorrow.", bucket: "screener", age: 7 * HOUR, seen: false, count: 1 },
  { from: ["Tallyhost", "billing@tallyhost.example"], subject: "Invoice 2291 is ready", body: "Your invoice for the Starter plan is ready to view. The amount of 12.00 was charged to your card on file.", bucket: "screener", age: 2 * DAY + 5 * HOUR, seen: false, count: 1 },

  // Automated notices that land in the Feed: no unsubscribe header, so the front page folds them away.
  { from: ["Mail Delivery Subsystem", "mailer-daemon@northwind.example"], subject: "Failed to deliver message", body: "Your message could not be delivered to the following recipients: hello@thirty.example (host rejected command DATA with code 554: duplicate header).", bucket: "feed", age: 5 * HOUR, seen: false, count: 1 },
  { from: ["Mail Delivery Subsystem", "mailer-daemon@northwind.example"], subject: "Failed to deliver message", body: "Your message could not be delivered to the following recipients: hello@thirty.example (host rejected command DATA with code 554).", bucket: "feed", age: 6 * HOUR, seen: false, count: 1 },
  { from: ["Mail Delivery Subsystem", "mailer-daemon@northwind.example"], subject: "Warning: Delay in message delivery", body: "There was a temporary problem delivering your message to thirty.example. The server will keep trying.", bucket: "feed", age: 7 * HOUR, seen: false, count: 1 },
  { from: ["Cloud Support", "support@cloudsupport.example"], subject: "[Case 4820] New correspondence added", body: "A new reply was added to your case 4820. To view it, visit the support center.", bucket: "feed", age: 1 * DAY + 2 * HOUR, seen: false, count: 1 },
  { from: ["Cloud Support", "support@cloudsupport.example"], subject: "[Case 4820] Production access", body: "Thank you for submitting your request to raise your sending limits. We have moved your account out of the sandbox.", bucket: "feed", age: 1 * DAY + 3 * HOUR, seen: false, count: 1 },
  // Sent. `lastMine` means you wrote last and are waiting on an answer; otherwise they have replied.
  { from: ["Tom Whitfield", "tom@whitfield.example"], subject: "Flat viewing, Saturday 11am", body: "Can you confirm the agent has the keys? I would rather not stand outside at eleven on a Saturday.", bucket: "sent", age: 5 * DAY, seen: true, count: 2, lastMine: true },
  { from: ["Aiko Tanaka", "aiko@tanaka.example"], subject: "Recommendation for the design lead role", body: "Sending the two lines you asked for. Happy to adjust the second one if it reads too strong for the panel.", bucket: "sent", age: 3 * DAY, seen: true, count: 3, lastMine: true },
  { from: ["Noah Bennett", "noah@bennett.example"], subject: "Book you asked about", body: "It is called The Timeless Way. I will bring my copy on Thursday.", bucket: "sent", age: 1 * DAY + 2 * HOUR, seen: true, count: 2, lastMine: true },
  { from: ["Sofia Alvarez", "sofia@alvarez.example"], subject: "Offsite agenda, dinner booking", body: "Added the dinner. Thursday or Friday works for me, which do you prefer?", bucket: "sent", age: 6 * HOUR, seen: false, count: 4 },
  { from: ["Priya Raman", "priya@raman.example"], subject: "Q4 plan, second pass", body: "Two comments on page three, otherwise this reads well. Thank you for turning it around so fast.", bucket: "sent", age: 2 * DAY, seen: true, count: 3 },
  // Feed (newsletters)
  { from: ["The Weekly Build", "hello@weeklybuild.example"], subject: "Issue 214: Making software feel quiet", body: "This week: why the best interfaces do less, a teardown of three calendar apps, and a reading list on attention.", bucket: "feed", age: 2 * HOUR, seen: false, count: 1, unsub: true },
  { from: ["Field Notes", "editor@fieldnotes.example"], subject: "The case for boring technology", body: "Every team has a budget of novelty. Spend it on the product, not the plumbing. Here is how three companies decided.", bucket: "feed", age: 6 * HOUR, seen: false, count: 1, unsub: true },
  { from: ["Kite Design", "news@kitedesign.example"], subject: "New: typographic scales, explained", body: "A new short course on building a type scale that holds together from phone to poster, with a free worksheet.", bucket: "feed", age: 1 * DAY, seen: false, count: 1, unsub: true },
  { from: ["Morning Brief", "team@morningbrief.example"], subject: "Markets, weather and one good read", body: "Stocks were mixed, rain clears by noon, and today's long read is about the people who keep the internet's clocks accurate.", bucket: "feed", age: 1 * DAY + 4 * HOUR, seen: true, count: 1, unsub: true },
  { from: ["Postcard Weekly", "hi@postcardweekly.example"], subject: "Five places to see before spring", body: "Slow trains, small towns and one lighthouse. This week's picks from readers, with maps and honest prices.", bucket: "feed", age: 2 * DAY + 2 * HOUR, seen: true, count: 1, unsub: true },
  { from: ["Fern & Co", "letters@fernand.example"], subject: "Your plant of the month", body: "March's pick is the calathea: forgiving, patterned and happy in low light. Care notes and a discount code inside.", bucket: "feed", age: 3 * DAY, seen: true, count: 1, unsub: true },

  // Paper Trail (receipts and confirmations)
  { from: ["Northwind Air", "bookings@northwindair.example"], subject: "Your booking confirmation: AMS to LIS", body: "You are booked on flight NW 412 on 14 March. Departure 07:40, arrival 09:55. Your reference is K7Q2ML.", bucket: "paper_trail", age: 4 * HOUR, seen: false, count: 1, attach: true, file: ["booking-K7Q2ML.pdf", "application/pdf", 61440] },
  { from: ["Cloudbox", "billing@cloudbox.example"], subject: "Receipt for your November plan", body: "Thanks for your payment of 24.00 for the Team plan. Your next invoice is on 1 December. A PDF receipt is attached.", bucket: "paper_trail", age: 1 * DAY, seen: false, count: 1, attach: true, file: ["receipt-november.pdf", "application/pdf", 48211] },
  { from: ["Brasserie Lune", "reservations@brasserielune.example"], subject: "Table for four, Thursday 12:30", body: "Your table is reserved. If your plans change, please let us know by noon on the day so we can offer it to someone else.", bucket: "paper_trail", age: 2 * DAY, seen: true, count: 1 },
  { from: ["City Power", "no-reply@citypower.example"], subject: "Your November statement is ready", body: "Your statement for November is ready to view. The amount due is 68.40, payable by 12 December by direct debit.", bucket: "paper_trail", age: 4 * DAY, seen: true, count: 1 },
  { from: ["Parcelpoint", "updates@parcelpoint.example"], subject: "Delivered: your order from Kite Design", body: "Your parcel was delivered today at 14:12 and left with a neighbour at number 9. A photo of the delivery is attached.", bucket: "paper_trail", age: 5 * DAY, seen: true, count: 1, attach: true, file: ["delivery-photo.jpg", "image/jpeg", 204800] },
];

const contacts = new Map();
function contact(name, email, status, seenAt) {
  const c = contacts.get(email);
  if (c) {
    c.count++;
    c.last = Math.max(c.last, seenAt);
    return;
  }
  contacts.set(email, { id: uid(), name, email, status, first: seenAt - 14 * DAY, last: seenAt, count: 1 });
}

for (const t of threads) {
  const [name, email] = t.from;
  const at = ago(t.age);
  const threadId = uid();
  const status = t.bucket === "screener" ? "pending" : t.bucket === "sent" ? "imbox" : t.bucket;
  contact(name, email, status, at);
  const participants = [{ email, name }, { email: ME.email, name: ME.name }];
  await pool.query(
    `INSERT INTO threads (id, account_id, gmail_thread_id, subject, custom_subject, snippet, bucket, seen, unread, reply_later, reply_later_at, set_aside, set_aside_at, bubble_up_at, bubbled, merged_into, note, has_attachments, trackers_blocked, participants_json, last_from_email, last_from_name, message_count, first_message_at, last_message_at, is_sent_only, created_at, updated_at)
     VALUES ($1,$2,$1,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,NULL,0,NULL,'',$12,0,$13,$14,$15,$16,$17,$18,0,$18,$18)`,
    [threadId, accountId, t.subject, snip(t.body), t.bucket === "screener" ? "screener" : t.bucket, t.seen ? 1 : 0, t.seen ? 0 : 1, t.replyLater ? 1 : 0, t.replyLater ? at : null, t.setAside ? 1 : 0, t.setAside ? at : null, t.attach ? 1 : 0, JSON.stringify(participants), t.lastMine ? ME.email : email, t.lastMine ? ME.name : name, t.count, at - (t.count - 1) * 3 * HOUR, at],
  );
  const first = name.split(" ")[0];
  const asMail = (body, signoff) => `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a"><p>${body}</p>${signoff ? `<p>${signoff}</p>` : ""}</div>`;
  const person = t.bucket === "imbox" || t.bucket === "screener";
  // Earlier messages of a longer conversation alternate between the sender and you; the newest is always theirs.
  const earlier = [
    ["them", "Thanks for getting back to me. Before I go further, could you tell me what you have in mind for timing?"],
    ["me", "Happy to. Sometime next week works for me, ideally mid-morning. What suits you?"],
    ["them", "Wednesday or Thursday would be good. I will keep both mornings free until you confirm."],
    ["me", "Thursday, then. I will send an invite so it is in both calendars."],
    ["them", "Perfect. One more thing: I will bring the printed version so we can mark it up together."],
  ];
  const insertMessage = async (m) => {
    const id = uid();
    await pool.query(
      `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, cc_json, bcc_json, reply_to, subject, date, snippet, text_body, html_body, is_from_me, unread, message_id_header, in_reply_to, references_header, list_unsubscribe, gmail_labels_json, has_attachments, trackers_json, size_estimate, created_at)
       VALUES ($1,$2,$3,$1,$4,$5,$6,'[]','[]','',$7,$8,$9,$10,$11,$12,$13,$14,'','',$16,'[]',$15,'[]',2048,$8)`,
      [id, accountId, threadId, m.fromMe ? ME.email : email, m.fromMe ? ME.name : name, JSON.stringify([m.fromMe ? { email, name } : { email: ME.email, name: ME.name }]), t.subject, m.at, snip(m.body), m.body, m.html, m.fromMe ? 1 : 0, m.unread ? 1 : 0, `<${uid()}@demo.example>`, m.attach ? 1 : 0, m.unsub ? `<https://${email.split("@")[1]}/unsubscribe>` : ""],
    );
    return id;
  };
  for (let i = 0; i < t.count - 1; i++) {
    const [who, text] = earlier[i % earlier.length];
    const fromMe = who === "me";
    await insertMessage({ fromMe, at: at - (t.count - 1 - i) * 3 * HOUR, body: text, html: asMail(text, fromMe ? ME.name.split(" ")[0] : first), unread: false, attach: false });
  }
  const newest = await insertMessage({ fromMe: !!t.lastMine, at, body: t.body, html: asMail(t.body, person ? first : ""), unread: !t.seen, attach: !!t.attach, unsub: !!t.unsub });
  if (t.file) {
    await pool.query(
      `INSERT INTO attachments (id, account_id, message_id, thread_id, gmail_attachment_id, filename, mime_type, size, content_id, is_inline, created_at) VALUES ($1,$2,$3,$4,$1,$5,$6,$7,'',0,$8)`,
      [uid(), accountId, newest, threadId, t.file[0], t.file[1], t.file[2], at],
    );
  }
}

// Drafts and mail set to go out later, for the Drafts and Scheduled pages.
const person = (name, email) => ({ name, email });
const draftRows = [
  ["draft", [person("Priya Raman", "priya@raman.example")], "Q4 plan, my comments", "<p>Priya, I read it twice. Page three needs a clearer owner for the migration, and the budget line looks low.</p>", 40 * MIN, null],
  ["draft", [person("Priya Raman", "priya@raman.example")], "Offsite budget", "<p>Quick note on the budget for the offsite before the review.</p>", 3 * HOUR, null],
  ["draft", [person("Daniel Okafor", "daniel@brightloop.example")], "Thursday lunch: the table", "<p>Booked for four at 12:30. I will send the address tomorrow.</p>", 5 * HOUR, null],
  ["draft", [person("Sofia Alvarez", "sofia@alvarez.example"), person("Tom Whitfield", "tom@whitfield.example")], "Offsite dinner", "<p>Thursday or Friday? I can do either, tell me what suits the two of you.</p>", 1 * DAY, null],
  ["draft", [], "Notes for the design review", "<p>Three things to raise: the wordmark, the spacing scale, the empty states.</p>", 2 * DAY, null],
  ["scheduled", [person("Aiko Tanaka", "aiko@tanaka.example")], "Reference for the design lead role", "<p>As promised, two lines for the panel.</p>", 2 * HOUR, now + 16 * HOUR],
  ["scheduled", [person("Noah Bennett", "noah@bennett.example")], "Book you asked about", "<p>It is called The Timeless Way.</p>", 6 * HOUR, now + 2 * DAY + 3 * HOUR],
];
for (const [status, to, subject, html, ageMs, sendAt] of draftRows) {
  await pool.query(
    `INSERT INTO drafts (id, account_id, thread_id, reply_to_message_id, to_json, cc_json, bcc_json, subject, body_html, send_at, status, error, created_at, updated_at) VALUES ($1,$2,NULL,NULL,$3,'[]','[]',$4,$5,$6,$7,NULL,$8,$8)`,
    [uid(), accountId, JSON.stringify(to), subject, html, sendAt, status, ago(ageMs)],
  );
}

for (const c of contacts.values()) {
  await pool.query(
    `INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, avatar_url, bundled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10,0)`,
    [c.id, accountId, c.email, c.name, c.status, c.status === "pending" ? null : c.first, c.first, c.last, c.count, logoFor(c.email)],
  );
}

// A calendar with a week of events
const calId = uid();
await pool.query(
  `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, created_at, updated_at)
   VALUES ($1,$2,NULL,'local','','','Calendar','','#111111','UTC',1,1,1,0,$3,$3)`,
  [calId, user.id, now],
);
const at = (dayOffset, hour, minute = 0) => {
  const d = new Date(now);
  d.setUTCHours(hour, minute, 0, 0);
  return d.getTime() + dayOffset * DAY;
};
const events = [
  ["Team standup", 0, 9, 30, 15, ""],
  ["Lunch with Daniel and Priya", 0, 12, 30, 90, "Brasserie Lune"],
  ["Design review", 0, 15, 0, 60, "Room 2"],
  ["Deep work: Q4 plan", 1, 10, 0, 120, ""],
  ["Call with Marcus", 1, 14, 0, 30, ""],
  ["Offsite dinner", 2, 19, 0, 120, "Harbour Street"],
  ["Flight AMS to LIS", 3, 7, 40, 135, "Schiphol"],
  ["Flat viewing", 4, 11, 0, 45, "Second floor"],
];
for (const [title, day, h, m, mins, loc] of events) {
  const s = at(day, h, m);
  await pool.query(
    `INSERT INTO events (id, user_id, calendar_id, remote_id, ical_uid, kind, title, description, location, emoji, all_day, starts_at, ends_at, start_date, end_date, timezone, rrule, exdates, master_id, occurrence_date, status, busy, countdown, circled, organizer_email, organizer_name, attendees_json, rsvp, conference_url, url, reminders_json, thread_id, message_id, created_at, updated_at)
     VALUES ($1,$2,$3,NULL,$4,'event',$5,'',$6,'',0,$7,$8,NULL,NULL,'UTC',NULL,'',NULL,NULL,'confirmed',1,0,0,'','','[]','','','','[]',NULL,NULL,$9,$9)`,
    [uid(), user.id, calId, `${uid()}@demo.example`, title, loc, s, s + mins * MIN, now],
  );
}

// A daily brief written by the AI (made up here: the demo has no model), so the Imbox card shows a meeting with Join and a reply waiting.
{
  const start = Math.ceil((now + 75 * MIN) / (30 * MIN)) * 30 * MIN;
  const meetingId = uid();
  const join = "https://meet.example/northwind-roadmap";
  await pool.query(
    `INSERT INTO events (id, user_id, calendar_id, remote_id, ical_uid, kind, title, description, location, emoji, all_day, starts_at, ends_at, start_date, end_date, timezone, rrule, exdates, master_id, occurrence_date, status, busy, countdown, circled, organizer_email, organizer_name, attendees_json, rsvp, conference_url, url, reminders_json, thread_id, message_id, created_at, updated_at)
     VALUES ($1,$2,$3,NULL,$4,'event',$5,'','Online','',0,$6,$7,NULL,NULL,'UTC',NULL,'',NULL,NULL,'confirmed',1,0,0,'','','[]','',$8,'','[]',NULL,NULL,$9,$9)`,
    [meetingId, user.id, calId, `${uid()}@demo.example`, "Northwind roadmap check-in", start, start + 30 * MIN, join, now],
  );
  const waiting = (await pool.query(`SELECT id FROM threads WHERE subject = 'Re: Brand refresh, second round' LIMIT 1`)).rows[0];
  if (waiting) {
    const brief = {
      day: new Date(now).toISOString().slice(0, 10),
      headline: "1 meeting left today · 1 waiting for your reply",
      items: [{ thread_id: waiting.id, account_id: accountId, subject: "Re: Brand refresh, second round", from_name: "Marcus Hale", from_email: "marcus@hale-studio.example", kind: "reply", why: "Asks which logo direction you prefer", urgent: false, age_days: 0 }],
      meetings: [{ id: meetingId, title: "Northwind roadmap check-in", starts_at: start, ends_at: start + 30 * MIN, all_day: false, join_url: join, location: "Online" }],
      source: "ai",
      // No thought of the day: a brief without the field is asked to write one, which the demo has no AI to do.
      thought: null,
      created_at: now - 9 * MIN,
    };
    await pool.query(`INSERT INTO daily_briefs (user_id, day, body, source, model, created_at) VALUES ($1,$2,$3,'ai','demo',$4)`, [user.id, brief.day, JSON.stringify(brief), brief.created_at]);
  }
}

// A month of AI use, so the AI Usage page has something to show. Busier on weekdays, with a few failures.
const aiFeatures = [
  ["chat", 0.3, 2400, 420],
  ["screener", 0.35, 900, 110],
  ["brief", 0.08, 3100, 520],
  ["gist", 0.2, 600, 45],
  ["rescue", 0.04, 1100, 60],
  ["agents", 0.03, 2700, 380],
];
let seededCalls = 0;
for (let d = 29; d >= 0; d--) {
  const weekday = new Date(now - d * DAY).getUTCDay();
  const perDay = weekday === 0 || weekday === 6 ? 40 : 130 + ((d * 37) % 60);
  for (let i = 0; i < perDay; i++) {
    let pick = ((i * 7919 + d * 104729) % 1000) / 1000;
    const f = aiFeatures.find((x) => (pick -= x[1]) < 0) ?? aiFeatures[1];
    const jitter = 0.6 + (((i * 31 + d * 17) % 80) / 100);
    const t = now - d * DAY - ((i * 6113) % (20 * HOUR));
    await pool.query(
      `INSERT INTO ai_calls (id, user_id, feature, model, input_tokens, output_tokens, estimated, ms, ok, created_at) VALUES ($1,$2,$3,'google.gemma-4-31b',$4,$5,0,$6,$7,$8)`,
      [uid(), user.id, f[0], Math.round(f[2] * jitter), Math.round(f[3] * jitter), Math.round(700 + ((i * 53) % 1800)), i % 250 === 0 ? 0 : 1, t],
    );
    seededCalls++;
  }
}

await pool.query("COMMIT");
console.log(`Seeded ${threads.length} threads, ${contacts.size} contacts, ${events.length} events for ${ME.email}`);
await pool.end();
