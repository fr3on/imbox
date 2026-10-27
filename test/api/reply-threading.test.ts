import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testEnv, seedUser } from "../helpers";
import { receiveInbound } from "../../src/api/inbound";
import { sendMail, referencesWithOwnId } from "../../src/api/send";
import { listNotifications } from "../../src/api/notifications";
import type { AccountRow } from "../../src/api/db";

// A reply to mail we sent has to land in the same thread, even when the sending service replaced our Message-ID on the way out
// (Resend runs on Amazon SES, which does), and a reply to something you wrote has to notify wherever its sender is filed.

const ME = "maya@chen.test";
const SAM = "sam@example.org";
const SES_ID = "<0100019ab-real@email.amazonses.com>";
// A reply comes later than what it answers (the Date header has whole seconds only, so a reply "now" could look older than the message just sent).
const nowStr = () => new Date(Date.now() + 120_000).toUTCString();

const raw = (o: { from?: string; subject: string; id: string; inReplyTo?: string; references?: string }) =>
  new TextEncoder().encode(
    [
      `From: ${o.from ?? `Sam Ortiz <${SAM}>`}`,
      `To: ${ME}`,
      `Subject: ${o.subject}`,
      `Message-ID: <${o.id}@example.org>`,
      `Date: ${nowStr()}`,
      o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : "",
      o.references ? `References: ${o.references}` : "",
      "Content-Type: text/plain",
      "",
      "Done.",
    ]
      .filter((l) => l !== "")
      .join("\r\n")
      .replace("Content-Type: text/plain\r\nDone.", "Content-Type: text/plain\r\n\r\nDone.")
  ).buffer as ArrayBuffer;

const deliver = (o: Parameters<typeof raw>[0]) => receiveInbound(testEnv, { from: SAM, to: ME, raw: raw(o) });
const threads = async () => (await testEnv.DB.prepare(`SELECT id, bucket, subject FROM threads ORDER BY created_at`).all<{ id: string; bucket: string; subject: string }>()).results;
const messageThreads = async () => (await testEnv.DB.prepare(`SELECT thread_id FROM messages ORDER BY created_at`).all<{ thread_id: string }>()).results.map((r) => r.thread_id);

let account: AccountRow;
let resendBody: { headers: Record<string, string> } | null;

/** Send "Quarterly plan" to Sam through the Resend path, as the app does, and return the Message-ID we put on it. */
async function sendFirst(): Promise<{ ourId: string; threadId: string }> {
  const sent = await sendMail(testEnv, account, { to: [{ email: SAM, name: "Sam Ortiz" }], subject: "Quarterly plan", body_html: "<p>Hi Sam, here is the plan.</p>" });
  return { ourId: resendBody!.headers["Message-ID"], threadId: sent.thread_id };
}

beforeEach(async () => {
  await seedUser();
  (testEnv as any).RESEND_API_KEY = "re_test";
  await testEnv.DB.prepare(
    `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, scopes, initial_sync_done, sync_status, signature, cover_art, avatar_url, created_at)
     VALUES ('dom1', 'u1', 'domain', ?, 'Maya Chen', '', '', '', 1, 'idle', '', '', '', ?)`
  ).bind(ME, Date.now()).run();
  account = (await testEnv.DB.prepare(`SELECT * FROM accounts WHERE id = 'dom1'`).first<AccountRow>())!;
  resendBody = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: any, init: any) => {
    if (String(_url).includes("api.resend.com")) resendBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: "re-1" }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (testEnv as any).RESEND_API_KEY;
});

describe("what goes out", () => {
  it("puts our own Message-ID in References too, so a reply carries it back", async () => {
    const { ourId } = await sendFirst();
    expect(ourId).toMatch(/^<.+@chen\.test>$/);
    expect(resendBody!.headers["References"]).toContain(ourId);
  });

  it("keeps the earlier References and adds ours at the end", () => {
    expect(referencesWithOwnId("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
    expect(referencesWithOwnId("", "<c@x>")).toBe("<c@x>");
  });
});

describe("a reply to mail we sent", () => {
  it("joins the thread when it carries our ID in References (the sender replaced the Message-ID)", async () => {
    const { ourId, threadId } = await sendFirst();
    const r = await deliver({ subject: "Re: Quarterly plan", id: "r1", inReplyTo: SES_ID, references: `${ourId} ${SES_ID}` });
    expect(r).toEqual({ status: 202, stored: true });
    expect((await threads()).length).toBe(1);
    expect((await messageThreads()).every((t) => t === threadId)).toBe(true);
  });

  it("joins the thread by subject and people when it names only an ID we never kept (mail sent before this fix)", async () => {
    const { threadId } = await sendFirst();
    await deliver({ subject: "Re: Quarterly plan", id: "r2", inReplyTo: SES_ID, references: SES_ID });
    expect((await threads()).length).toBe(1);
    expect((await messageThreads()).every((t) => t === threadId)).toBe(true);
  });

  it("does not join a thread with another subject", async () => {
    await sendFirst();
    await deliver({ subject: "Re: Lunch on Thursday?", id: "r3", inReplyTo: SES_ID, references: SES_ID });
    expect((await threads()).length).toBe(2);
  });

  it("does not join when the sender never took part in that thread", async () => {
    await sendFirst();
    await deliver({ from: "Eve <eve@elsewhere.test>", subject: "Re: Quarterly plan", id: "r4", inReplyTo: SES_ID, references: SES_ID });
    expect((await threads()).length).toBe(2);
  });

  it("does not treat a fresh message with the same subject as a reply", async () => {
    await sendFirst();
    await deliver({ subject: "Quarterly plan", id: "r5" }); // no In-Reply-To, no References, no Re:
    expect((await threads()).length).toBe(2);
    await deliver({ subject: "Quarterly plan", id: "r6", inReplyTo: SES_ID }); // names a parent but the subject says it is not a reply
    expect((await threads()).length).toBe(3);
  });

  it("still joins by Message-ID when the ID is one we kept", async () => {
    const { ourId, threadId } = await sendFirst();
    await deliver({ subject: "Something else entirely", id: "r7", inReplyTo: ourId, references: ourId });
    expect((await threads()).length).toBe(1);
    expect((await messageThreads()).every((t) => t === threadId)).toBe(true);
  });
});

describe("notifications for a reply", () => {
  it("count a reply in a conversation you wrote in, even when the sender is filed under Updates", async () => {
    // Sam was sorted into Feeds before you wrote to him, so the thread stays under Updates. The reply names our ID, so it joins that thread.
    const { ourId } = await sendFirst();
    await testEnv.DB.prepare(`UPDATE threads SET bucket = 'feed' WHERE id = ?`).bind((await threads())[0].id).run();
    await deliver({ subject: "Re: Quarterly plan", id: "n1", inReplyTo: ourId, references: ourId });
    const all = await threads();
    expect(all.length).toBe(1);
    expect(all[0].bucket).toBe("feed");
    const mail = (await listNotifications(testEnv.DB, "u1")).filter((n) => n.kind === "mail");
    expect(mail.map((n) => n.title)).toContain("Sam Ortiz");
  });

  it("stay quiet for an Updates thread you never wrote in", async () => {
    await deliver({ subject: "Weekly digest", id: "n2" });
    await testEnv.DB.prepare(`UPDATE threads SET bucket = 'feed'`).run();
    const mail = (await listNotifications(testEnv.DB, "u1")).filter((n) => n.kind === "mail");
    expect(mail).toEqual([]);
  });
});
