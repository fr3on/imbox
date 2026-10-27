import type { AiSseEvent } from "@/api";
import type { AiDraftCard, AiEventProposal, AiBulkActionProposal, AiWorkflowProposal } from "@shared/types";
import type { ContextChip } from "@/lib/assistantStore";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  context?: ContextChip[];
  tools: { id: string; status: "running" | "done" | "error"; summary: string }[];
  drafts: AiDraftCard[];
  eventProposals?: AiEventProposal[];
  workflowProposals?: AiWorkflowProposal[];
  bulkActionProposals?: AiBulkActionProposal[];
  sent: Record<string, string>;
  error?: string;
}

export function turnsFromStored(messages: { id: string; role: "user" | "assistant"; content: unknown[] }[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? (m.content as any[]) : [];
    if (m.role === "user") {
      const ctx: ContextChip[] = [];
      const texts: string[] = [];
      for (const b of blocks) {
        if (b.type !== "text" || typeof b.text !== "string") continue;
        const m2 = /^\[\[context thread=([^\]]+)\]\] Subject: (.*?) · From: (.*?)(?:\n|$)/.exec(b.text);
        if (m2) ctx.push({ id: m2[1], subject: m2[2], from: m2[3] });
        else texts.push(b.text);
      }
      const text = texts.join("\n");
      if (text.trim()) out.push({ id: m.id, role: "user", text, context: ctx, tools: [], drafts: [], eventProposals: [], bulkActionProposals: [], sent: {} });
      continue;
    }
    const last = out[out.length - 1];
    const target = last && last.role === "assistant" ? last : (out.push({ id: m.id, role: "assistant", text: "", tools: [], drafts: [], eventProposals: [], bulkActionProposals: [], sent: {} }), out[out.length - 1]);
    for (const b of blocks) {
      if (b.type === "text") target.text += (target.text ? "\n\n" : "") + b.text;
      else if (b.type === "tool_use") target.tools.push({ id: b.id, status: "done", summary: toolLabel(b.name, b.input) });
    }
  }
  return out;
}

export function toolLabel(name: string, input: any): string {
  switch (name) {
    case "search_mail": {
      const parts: string[] = [];
      if (input?.query) parts.push(`“${input.query}”`);
      if (input?.from_sender) parts.push(`from ${input.from_sender}`);
      if (input?.unread_only) parts.push("unread");
      if (input?.has_attachment) parts.push("with attachments");
      if (input?.bucket) parts.push(`in ${String(input.bucket).replace("_", " ")}`);
      if (input?.label) parts.push(`labeled ${input.label}`);
      return `Searched mail${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "list_threads": return `Listed ${String(input?.bucket ?? "").replace("_", " ")}`;
    case "read_thread": return "Read a thread";
    case "list_screener": return "Checked the Screener";
    case "screen_sender": return `Screened a sender → ${String(input?.decision ?? "").replace("_", " ")}`;
    case "thread_action": return `Organised · ${String(input?.action ?? "").replace("_", " ")}`;
    case "create_draft": return `Drafted “${input?.subject ?? "a message"}”`;
    case "send_draft": return "Sent a draft";
    case "remember": return `Remembered: ${input?.content ?? ""}`;
    case "forget": return "Forgot a memory entry";
    case "find_contact": return `Looked up “${input?.query ?? ""}”`;
    case "save_clip": return "Saved a clip";
    case "create_collection": return `Created collection “${input?.name ?? ""}”`;
    case "add_to_collection": return "Added to a collection";
    case "list_events": return `Checked calendar (${input?.from ?? "upcoming"})`;
    case "find_free_time": return `Looked for free time on ${input?.from_date ?? "calendar"}`;
    case "propose_event": return `Proposed event “${input?.title ?? "new event"}”`;
    case "draft_workflow": return `Drafted workflow \u201c${input?.name ?? "new workflow"}\u201d`;
    case "get_daily_brief": return "Loaded Daily Brief";
    case "catch_up_thread": return "Caught up on thread";
    case "find_thread_actions": return "Checked asks & deadlines";
    case "set_contact_destination": return `Set ${input?.email ?? "contact"} destination → ${String(input?.destination ?? "").replace("_", " ")}`;
    case "bundle_sender": return `${input?.bundled === false ? "Unbundled" : "Bundled"} ${input?.email ?? "sender"}`;
    case "list_noisy_or_misfiled_senders": return `Checked for ${input?.kind ?? "noisy & misfiled"} senders`;
    case "bulk_thread_action": return `Bulk action · ${String(input?.action ?? "").replace("_", " ")}`;
    case "undo_bulk_action": return "Undid bulk action";
    default: return name.replace(/_/g, " ");
  }
}

/** What one event from the stream does to the turn being written. An event with nothing to say changes nothing. */
export function applyEvent(l: Turn | null, e: AiSseEvent): Turn | null {
  if (e.type === "text") return l ? { ...l, text: l.text + e.text } : l;
  if (e.type === "tool") return l ? { ...l, tools: l.tools.some((x) => x.id === e.id) ? l.tools.map((x) => (x.id === e.id ? { ...x, status: e.status, summary: e.summary } : x)) : [...l.tools, { id: e.id, status: e.status, summary: e.summary }] } : l;
  if (e.type === "draft") return l ? { ...l, drafts: [...l.drafts, e.draft] } : l;
  if (e.type === "event_proposal") return l ? { ...l, eventProposals: [...(l.eventProposals ?? []), e.proposal] } : l;
  if (e.type === "workflow_proposal") return l ? { ...l, workflowProposals: [...(l.workflowProposals ?? []), e.proposal] } : l;
  if (e.type === "bulk_action_proposal") return l ? { ...l, bulkActionProposals: [...(l.bulkActionProposals ?? []), e.proposal] } : l;
  if (e.type === "sent") return l ? { ...l, sent: { ...l.sent, [e.draft_id]: e.thread_id } } : l;
  if (e.type === "error") return l ? { ...l, error: e.message } : l;
  return l;
}
