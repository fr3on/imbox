import React, { useState } from "react";
import { ArrowLeft, Brain, Check, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { BrandIcon } from "../BrandIcons";
import type { AutoAgent, AutoAgentMemoryItem, AutoAgentMemoryKind } from "../../api";
import { useAutoAgentMemory, useAutoAgentMemoryMutations } from "../../api";
import { Danger, Panel, Section } from "../../settings/parts";
import { fmtRelative } from "../../lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_KIND_HINT,
  AGENT_KIND_ICON,
  AGENT_MEMORY_KINDS,
  KIND_LABEL,
  KIND_PLACEHOLDER,
  MEMORY_TEMPLATES,
} from "./templates";

export function AgentMemoryPage({ agent, onBack }: { agent: AutoAgent; onBack: () => void }) {
  const q = useAutoAgentMemory(agent.id);
  const m = useAutoAgentMemoryMutations(agent.id);
  const [adding, setAdding] = useState("");
  const [addKind, setAddKind] = useState<AutoAgentMemoryKind>("faq");
  const [editing, setEditing] = useState<{ id: string; content: string; kind: AutoAgentMemoryKind } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [filter, setFilter] = useState<AutoAgentMemoryKind | "all">("all");

  const memories = q.data ?? [];
  const count = (k: AutoAgentMemoryKind) => memories.filter((r) => r.kind === k).length;
  const shown = AGENT_MEMORY_KINDS.filter((k) => (filter === "all" || filter === k) && count(k) > 0);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adding.trim()) return;
    m.add.mutate(
      { kind: addKind, content: adding.trim() },
      {
        onSuccess: () => {
          toast("Added to its memory");
          setAdding("");
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };
  const handleApplyTemplate = (tmpl: { kind: AutoAgentMemoryKind; text: string }) => {
    setAddKind(tmpl.kind);
    setAdding(tmpl.text);
  };
  const remove = (r: AutoAgentMemoryItem) =>
    m.remove.mutate(r.id, {
      onSuccess: () => toast("Forgotten", { action: { label: "Undo", onClick: () => m.add.mutate({ kind: r.kind, content: r.content }) } }),
      onError: (err) => toast.error((err as Error).message),
    });
  const saveEdit = () => {
    if (!editing) return;
    const content = editing.content.trim();
    if (content) m.update.mutate({ id: editing.id, kind: editing.kind, content });
    setEditing(null);
  };

  return (
    <Section
      title={`${agent.name} · memory`}
      description="What this agent knows and applies when it handles mail: answers, rules, facts and how to sound. It follows these on top of its instructions."
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft /> Agents
          </Button>
          {memories.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => setClearOpen(true)}>
              <BrandIcon name="trash" size={13} /> Forget all
            </Button>
          )}
        </div>
      }
    >
      <Panel>
        {memories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3" role="tablist" aria-label="Kinds of memory">
            {([["all", "All", memories.length], ...AGENT_MEMORY_KINDS.map((k) => [k, KIND_LABEL[k], count(k)] as const)] as const).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={filter === k}
                disabled={k !== "all" && n === 0}
                onClick={() => setFilter(k as AutoAgentMemoryKind | "all")}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors disabled:opacity-40",
                  filter === k ? "bg-foreground font-medium text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
                <span className={cn("tnum text-[11px]", filter === k ? "text-background/70" : "text-tertiary")}>{n}</span>
              </button>
            ))}
          </div>
        )}

        {q.isLoading ? (
          <div className="py-12 text-center text-[13px] text-muted-foreground">
            <Loader2 className="mx-auto mb-2 animate-spin" size={16} />
            Loading…
          </div>
        ) : memories.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Brain size={18} />
            </div>
            <div className="text-sm font-medium">Nothing taught yet</div>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Add the facts and rules this agent needs so it does not leave threads unanswered. Start from one of these:</p>
            <div className="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-1.5">
              {MEMORY_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => handleApplyTemplate(t)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground [&>svg]:size-3.5"
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {shown.map((k) => (
              <div key={k} className="px-3 py-3 sm:px-4">
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <span className="text-muted-foreground [&>svg]:size-3.5">{AGENT_KIND_ICON[k]}</span>
                  <h3 className="text-[12.5px] font-semibold">{KIND_LABEL[k]}</h3>
                  <span className="text-xs text-muted-foreground">{AGENT_KIND_HINT[k]}</span>
                </div>
                <ul className="space-y-0.5">
                  {memories
                    .filter((r) => r.kind === k)
                    .sort((x, y) => y.updated_at - x.updated_at)
                    .map((r) => (
                      <li key={r.id} className="group rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
                        {editing?.id === r.id ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind">
                              {AGENT_MEMORY_KINDS.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  role="radio"
                                  aria-checked={editing.kind === opt}
                                  onClick={() => setEditing((cur) => (cur ? { ...cur, kind: opt } : null))}
                                  className={cn(
                                    "inline-flex h-6 items-center gap-1 rounded px-2 text-[11.5px] [&>svg]:size-3",
                                    editing.kind === opt ? "bg-foreground font-medium text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  {AGENT_KIND_ICON[opt]} {KIND_LABEL[opt]}
                                </button>
                              ))}
                            </div>
                            <Textarea
                              autoFocus
                              rows={2}
                              value={editing.content}
                              onChange={(e) => setEditing((cur) => (cur ? { ...cur, content: e.target.value } : null))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  saveEdit();
                                }
                                if (e.key === "Escape") setEditing(null);
                              }}
                              className="text-[13px]"
                            />
                            <div className="flex items-center gap-1.5">
                              <Button size="xs" onClick={saveEdit} disabled={!editing.content.trim()}>
                                <Check /> Save
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                              <span className="text-xs text-tertiary">Enter saves, Esc cancels</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-[13.5px] leading-5 text-foreground">{r.content}</p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground" title={r.source === "learned" ? "The agent picked this up while handling mail" : "You added this"}>
                                <span className="[&>svg]:size-3">{r.source === "learned" ? <BrandIcon name="assistant" /> : <BrandIcon name="sender" />}</span>
                                {r.source === "learned" ? "Learned" : "You"} · {fmtRelative(r.updated_at)}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
                              <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-foreground" aria-label="Edit" onClick={() => setEditing({ id: r.id, content: r.content, kind: r.kind })}>
                                <Pencil size={12} />
                              </Button>
                              <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Forget this" onClick={() => remove(r)}>
                                <BrandIcon name="trash" size={12} />
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <form className="space-y-2.5 border-t border-border bg-muted/20 p-3 sm:p-4" onSubmit={handleAdd}>
          <div className="text-[12.5px] font-medium">Teach it something</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What kind of note">
            {AGENT_MEMORY_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={addKind === k}
                onClick={() => setAddKind(k)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors [&>svg]:size-3.5",
                  addKind === k ? "bg-foreground font-medium text-background" : "bg-background text-muted-foreground shadow-[0_0_0_1px_var(--border)] hover:text-foreground",
                )}
              >
                {AGENT_KIND_ICON[k]} {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={KIND_PLACEHOLDER[addKind]} className="h-8 flex-1 text-xs" />
            <Button type="submit" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" disabled={!adding.trim() || m.add.isPending}>
              {m.add.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Remember
            </Button>
          </div>
        </form>
      </Panel>

      <Danger
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Clear all memory for ${agent.name}?`}
        body="This permanently removes all memory notes, FAQ knowledge, and guidelines for this agent. It will only have its basic instructions."
        action="Clear all memory"
        onConfirm={() =>
          m.clear.mutate(undefined, {
            onSuccess: () => {
              toast("Agent memory cleared");
              setClearOpen(false);
            },
            onError: (err) => toast.error((err as Error).message),
          })
        }
      />
    </Section>
  );
}
