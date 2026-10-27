import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, StreamEvent } from "./provider";
import { describeApiError } from "./provider";

/**
 * A real check of what the assistant needs from a model.
 *
 * "Test connection" only asks for one word back, which proves the key and address work. The assistant
 * also needs to stream its answer, to call tools (that is how it reads your mail), to carry on after a
 * tool's result comes back, and to answer in JSON (that is how it learns your tone). A model can pass
 * the connection test and still fail at every one of those, so each is tried for real, with a made-up
 * tool that touches nothing.
 */

export type CheckId = "basic" | "stream" | "tools" | "roundtrip" | "json";
export interface CheckResult {
  id: CheckId;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  ms: number;
}

const CODE = "ZX-4172";
const LOOKUP: Anthropic.Tool = {
  name: "lookup_code",
  description: "Returns the secret code for a topic.",
  input_schema: { type: "object", properties: { topic: { type: "string", description: "The topic" } }, required: ["topic"], additionalProperties: false },
};

async function collect(stream: AsyncIterable<StreamEvent>): Promise<{ text: string; chunks: number; done?: Extract<StreamEvent, { type: "done" }>; error?: string }> {
  let text = "";
  let chunks = 0;
  let done: Extract<StreamEvent, { type: "done" }> | undefined;
  for await (const ev of stream) {
    if (ev.type === "text") {
      text += ev.text;
      chunks++;
    } else if (ev.type === "done") done = ev;
    else return { text, chunks, error: ev.message };
  }
  return { text, chunks, done };
}

export async function checkProvider(provider: LlmProvider, now: () => number = Date.now): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const run = async (id: CheckId, label: string, fn: () => Promise<{ status: CheckResult["status"]; detail: string }>) => {
    const t = now();
    try {
      const r = await fn();
      results.push({ id, label, ...r, ms: now() - t });
    } catch (e) {
      results.push({ id, label, status: "fail", detail: describeApiError(e), ms: now() - t });
    }
    return results[results.length - 1];
  };

  const basic = await run("basic", "Answers a question", async () => {
    const r = await provider.complete({ feature: "check", maxTokens: 20, effort: "low", messages: [{ role: "user", content: "Reply with the single word: ready" }] });
    return r.text.trim()
      ? { status: "pass", detail: `Replied “${r.text.trim().slice(0, 30)}”.` }
      : { status: "fail", detail: "The model returned an empty reply." };
  });
  // No point probing further features on a connection that does not work at all.
  if (basic.status === "fail") return results;

  await run("stream", "Streams its reply", async () => {
    const r = await collect(provider.stream({ feature: "check", system: "Be brief.", messages: [{ role: "user", content: "Count from 1 to 5." }], tools: [], maxTokens: 80, effort: "low" }));
    if (r.error) return { status: "fail", detail: r.error };
    if (!r.text.trim()) return { status: "warn", detail: "The stream finished but carried no text." };
    return { status: "pass", detail: `Arrived in ${r.chunks} ${r.chunks === 1 ? "piece" : "pieces"}.` };
  });

  const tools = await run("tools", "Calls tools", async () => {
    const r = await collect(
      provider.stream({ feature: "check",
        system: "You have a tool. Use it when asked for a code.",
        messages: [{ role: "user", content: "What is the secret code for the topic “test”? Use the lookup_code tool." }],
        tools: [LOOKUP],
        maxTokens: 200,
        effort: "low",
      })
    );
    if (r.error) return { status: "fail", detail: r.error };
    const call = r.done?.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
    if (!call) {
      return {
        status: "fail",
        detail: "It answered in words instead of calling the tool. The assistant could not read or act on your mail with this model — pick one that supports tool calling.",
      };
    }
    if (call.name !== LOOKUP.name) return { status: "fail", detail: `It called “${call.name}”, which does not exist.` };
    const input = call.input as { topic?: unknown; _raw?: unknown };
    if (input._raw !== undefined || typeof input.topic !== "string") return { status: "warn", detail: "It called the tool, but with arguments that were not valid JSON." };
    return { status: "pass", detail: "Called the tool with valid arguments." };
  });

  if (tools.status === "pass") {
    await run("roundtrip", "Continues after a tool result", async () => {
      const call: Anthropic.ToolUseBlockParam = { type: "tool_use", id: "call_check", name: LOOKUP.name, input: { topic: "test" } };
      const r = await collect(
        provider.stream({ feature: "check",
          system: "You have a tool. Use it when asked for a code.",
          messages: [
            { role: "user", content: "What is the secret code for the topic “test”? Use the lookup_code tool." },
            { role: "assistant", content: [call] },
            { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: `The code is ${CODE}.` }] },
          ],
          tools: [LOOKUP],
          maxTokens: 200,
          effort: "low",
        })
      );
      if (r.error) return { status: "fail", detail: r.error };
      if (!r.text.includes(CODE)) return { status: "warn", detail: "It carried on, but did not use the tool's answer." };
      return { status: "pass", detail: "Read the tool's answer and used it." };
    });
  }

  await run("json", "Answers in JSON", async () => {
    const r = await provider.complete({ feature: "check",
      maxTokens: 100,
      effort: "low",
      messages: [{ role: "user", content: 'Return an object with "ok" set to true and "word" set to "ready".' }],
      schema: { name: "check", zod: z.object({ ok: z.boolean(), word: z.string() }) },
    });
    if (r.json?.ok === true) return { status: "pass", detail: "Returned valid, structured JSON." };
    if (r.text.trim()) return { status: "warn", detail: "It replied, but not in valid JSON. Learning your tone from your mail may not work reliably." };
    return { status: "fail", detail: "The model returned nothing." };
  });

  return results;
}

/** One sentence for the person: what will and will not work with this model. */
export function summarizeCheck(results: CheckResult[]): { level: "good" | "limited" | "broken"; text: string } {
  const by = (id: CheckId) => results.find((r) => r.id === id);
  if (by("basic")?.status !== "pass") return { level: "broken", text: "The model did not answer. Fix the connection first." };
  if (by("tools")?.status !== "pass") return { level: "limited", text: "It can chat, but it cannot use tools, so it cannot read, sort or draft your mail. Choose a model with tool calling." };
  const soft = results.filter((r) => r.status !== "pass").map((r) => r.label.toLowerCase());
  if (soft.length) return { level: "limited", text: `The assistant works, with a caveat: it does not fully manage to ${soft.join(" and ")}.` };
  return { level: "good", text: "Everything the assistant needs works with this model." };
}
