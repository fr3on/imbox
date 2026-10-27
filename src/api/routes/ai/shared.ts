import type { AccountRow } from "../../db";
import { accountForThread } from "../../db";
import { AiNotConfigured, loadAiConfig } from "../../ai/provider";
import type { ChatDeps } from "../../ai/chat";
import { loadThreadDetail } from "../mail";

export async function userAccounts(c: any): Promise<AccountRow[]> {
  const r = await c.env.DB.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC`).bind(c.get("user").id).all();
  return r.results as AccountRow[];
}

export async function deps(c: any): Promise<ChatDeps> {
  const user = c.get("user");
  const cfg = await loadAiConfig(c.env, user.id);
  if (!cfg) throw new AiNotConfigured();
  return { env: c.env, user, accounts: await userAccounts(c), cfg };
}

export function shimFor(c: any, accounts: AccountRow[], acc: AccountRow | null) {
  const ids = accounts.map((a) => a.id);
  const vars: Record<string, unknown> = { user: c.get("user"), accountIds: ids, allAccountIds: ids, account: acc ?? accounts[0] ?? null };
  return { env: c.env, get: (k: string) => vars[k], req: { param: () => undefined, query: (k: string) => (k === "peek" ? "1" : undefined), json: async () => ({}) }, executionCtx: { waitUntil() { } } } as any;
}

export async function threadForAi(c: any, d: ChatDeps, threadId: string) {
  const acc = await accountForThread(c.env.DB, d.user.id, threadId);
  if (!acc) return null;
  const detail = await loadThreadDetail(shimFor(c, d.accounts, acc), threadId);
  if (!detail) return null;
  return { acc, detail };
}
