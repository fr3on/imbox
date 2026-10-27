import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { loadAiSettings, presetById } from "../../ai/provider";

const usage = new Hono<AppEnv>();

usage.get("/usage", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const row = await loadAiSettings(c.env, user.id);
  const preset = presetById(row?.preset ?? "anthropic");
  const mockOk = c.env.AI_MOCK === "1";
  const configured = !!row && (preset.kind === "mock" ? mockOk : preset.kind === "anthropic" ? !!row.api_key_enc : preset.editable_url ? !!(row.base_url || preset.base_url) : true);
  const asked = Number(c.req.query("days"));
  const days = [7, 30, 90].includes(asked) ? asked : 30;
  const DAY = 86_400_000;
  const since = Date.now() - days * DAY;

  const [byFeature, series, slow, first, skipped, runs, convs, letIns] = await Promise.all([
    db
      .prepare(
        `SELECT feature, COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS tokens_in, COALESCE(SUM(output_tokens), 0) AS tokens_out,
                COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS failed, COALESCE(SUM(estimated), 0) AS estimated
         FROM ai_calls WHERE user_id = ? AND created_at >= ? GROUP BY feature`
      )
      .bind(user.id, since)
      .all<{ feature: string; calls: number; tokens_in: number; tokens_out: number; failed: number; estimated: number }>(),
    db
      .prepare(`SELECT created_at / ${DAY}::bigint AS d, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM ai_calls WHERE user_id = ? AND created_at >= ? GROUP BY created_at / ${DAY}::bigint ORDER BY d NULLS FIRST`)
      .bind(user.id, since)
      .all<{ d: number; tokens: number }>(),
    db.prepare(`SELECT ms FROM ai_calls WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 2000`).bind(user.id, since).all<{ ms: number }>(),
    db.prepare(`SELECT MIN(created_at) AS t FROM ai_calls WHERE user_id = ?`).bind(user.id).first<{ t: number | null }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM auto_agent_runs WHERE user_id = ? AND status = 'skipped' AND created_at >= ?`).bind(user.id, since).first<{ n: number }>(),
    db
      .prepare(
        `SELECT r.id, r.thread_id, r.status, r.summary, r.subject, r.created_at, a.name AS agent_name FROM auto_agent_runs r LEFT JOIN auto_agents a ON a.id = r.agent_id
         WHERE r.user_id = ? AND r.status <> 'skipped' AND r.created_at >= ? ORDER BY r.created_at DESC LIMIT 15`
      )
      .bind(user.id, since)
      .all<{ id: string; thread_id: string; status: string; summary: string; subject: string; created_at: number; agent_name: string | null }>(),
    db.prepare(`SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 8`).bind(user.id, since).all<{ id: string; title: string; created_at: number; updated_at: number }>(),
    db.prepare(`SELECT id, email, name, reason, created_at FROM auto_let_ins WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 8`).bind(user.id, since).all<{ id: string; email: string; name: string; reason: string; created_at: number }>(),
  ]);

  const features = byFeature.results
    .map((f) => ({ feature: f.feature, calls: Number(f.calls), tokens_in: Number(f.tokens_in), tokens_out: Number(f.tokens_out), failed: Number(f.failed), estimated: Number(f.estimated) }))
    .sort((a, b) => b.tokens_in + b.tokens_out - (a.tokens_in + a.tokens_out));
  const sum = (k: "calls" | "tokens_in" | "tokens_out" | "failed" | "estimated") => features.reduce((n, f) => n + f[k], 0);
  const times = slow.results.map((r) => Number(r.ms)).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;

  type Event = { id: string; kind: "agent" | "chat" | "let_in"; title: string; subtitle: string; status: string; time: number; link?: string };
  const events: Event[] = [
    ...runs.results.map((r): Event => ({
      id: `run-${r.id}`,
      kind: "agent",
      title: r.subject || "Mail handled by an agent",
      subtitle: r.summary || (r.agent_name ? `Handled by ${r.agent_name}` : "Agent run"),
      status: r.status,
      time: r.created_at,
      link: r.thread_id ? `/t/${r.thread_id}` : undefined,
    })),
    ...convs.results.map((r): Event => ({ id: `chat-${r.id}`, kind: "chat", title: r.title || "Assistant chat", subtitle: "Assistant chat", status: "chat", time: r.updated_at || r.created_at })),
    ...letIns.results.map((r): Event => ({ id: `in-${r.id}`, kind: "let_in", title: `${r.name || r.email} let in`, subtitle: r.reason, status: "let_in", time: r.created_at })),
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, 20);

  return c.json({
    overview: { configured, provider: preset.kind, preset: preset.id, model: row?.model || preset.default_model },
    days,
    // The first call ever written down. Before it, nothing was measured, so a period that reaches back past it is only partly counted.
    counting_since: first?.t ?? null,
    totals: { calls: sum("calls"), tokens_in: sum("tokens_in"), tokens_out: sum("tokens_out"), failed: sum("failed"), estimated_calls: sum("estimated"), median_ms: median },
    series: series.results.map((r) => ({ day: Number(r.d), tokens: Number(r.tokens) })),
    by_feature: features,
    skipped_runs: Number(skipped?.n ?? 0),
    activity: events,
  });
});

export default usage;
