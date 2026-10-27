// Writes down every call to the AI provider, so the AI Usage page can add them up. It wraps a provider and passes everything through
// unchanged; the only addition is one row in ai_calls when a call ends. Writing that row can never fail a call.

import type { LlmProvider, StreamParams, StreamEvent, CompleteParams, Usage } from "./provider";

const COUNTED_AS_TEST = new Set(["check"]);

/** About four characters to a token: used only when the provider does not say how many it used. */
const roughTokens = (chars: number) => Math.ceil(chars / 4);
const size = (v: unknown): number => {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
};

export class MeteredProvider implements LlmProvider {
  constructor(
    private inner: LlmProvider,
    private sink: { db: Db; userId: string }
  ) {}

  get model() {
    return this.inner.model;
  }

  private async record(feature: string | undefined, usage: Usage | undefined, guess: { input: number; output: number }, started: number, ok: boolean) {
    const name = feature || "other";
    if (COUNTED_AS_TEST.has(name)) return;
    try {
      await this.sink.db
        .prepare(`INSERT INTO ai_calls (id, user_id, feature, model, input_tokens, output_tokens, estimated, ms, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), this.sink.userId, name, this.inner.model, usage?.input ?? guess.input, usage?.output ?? guess.output, usage ? 0 : 1, Date.now() - started, ok ? 1 : 0, Date.now())
        .run();
    } catch (e) {
      console.error("ai usage not recorded", (e as Error).message);
    }
  }

  async *stream(p: StreamParams): AsyncIterable<StreamEvent> {
    const started = Date.now();
    let usage: Usage | undefined;
    let outChars = 0;
    let ok = true;
    try {
      for await (const ev of this.inner.stream(p)) {
        if (ev.type === "text") outChars += ev.text.length;
        else if (ev.type === "done") {
          usage = ev.usage;
          if (!outChars) outChars = size(ev.content);
        } else ok = false;
        yield ev;
      }
    } catch (e) {
      ok = false;
      throw e;
    } finally {
      await this.record(p.feature, usage, { input: roughTokens(p.system.length + size(p.messages) + size(p.tools)), output: roughTokens(outChars) }, started, ok);
    }
  }

  async complete<T = unknown>(p: CompleteParams<T>) {
    const started = Date.now();
    const input = roughTokens((p.system?.length ?? 0) + size(p.messages));
    try {
      const r = await this.inner.complete(p);
      await this.record(p.feature ?? p.schema?.name, r.usage, { input, output: roughTokens(r.text.length) }, started, !r.refused);
      return r;
    } catch (e) {
      await this.record(p.feature ?? p.schema?.name, undefined, { input, output: 0 }, started, false);
      throw e;
    }
  }
}
