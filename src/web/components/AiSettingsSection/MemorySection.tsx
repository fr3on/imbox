import { BrandIcon } from "../BrandIcons";
import { useState, } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Check, Lightbulb, MessageSquareText, Pencil, PenLine, Plus, SlidersHorizontal, } from "lucide-react";
import { toast } from "sonner";
import type { AiMemoryKind, } from "@shared/types";
import { useAiMemory, useAiMutations, } from "../../api";
import { Section, Panel, } from "../../settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtRelative } from "../../lib/format";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<AiMemoryKind, string> = {
  profile: "About you",
  tone: "How you write",
  fact: "Facts",
  preference: "Preferences",
  contact: "People",
};
const KINDS: AiMemoryKind[] = ["profile", "tone", "fact", "preference", "contact"];

const KIND_ICON: Record<AiMemoryKind, React.ReactNode> = {
  profile: <BrandIcon name="sender" />,
  tone: <PenLine />,
  fact: <Lightbulb />,
  preference: <SlidersHorizontal />,
  contact: <BrandIcon name="sender" />,
};
const KIND_HINT: Record<AiMemoryKind, string> = {
  profile: "Who you are and what you do",
  tone: "How you sound in mail",
  fact: "Things worth remembering",
  preference: "How you like things done",
  contact: "Notes about people",
};
const KIND_EXAMPLE: Record<AiMemoryKind, string> = {
  profile: "I run support for Dike, in Riyadh",
  tone: "Sign replies with just Maya",
  fact: "Invoices go to billing@dataflare.com",
  preference: "Keep replies to two sentences",
  contact: "Reda handles payroll questions",
};
const SOURCE: Record<string, { label: string; icon: React.ReactNode; hint: string }> = {
  learned: { label: "Learned", icon: <BrandIcon name="assistant" />, hint: "Picked up from your mail" },
  user: { label: "You", icon: <BrandIcon name="sender" />, hint: "You added this" },
  assistant: { label: "Assistant", icon: <MessageSquareText />, hint: "The assistant saved this in a chat" },
};

export function MemorySection({ compact, onClear }: { compact?: boolean; onClear: () => void }) {
  const mem = useAiMemory();
  const m = useAiMutations();
  const [adding, setAdding] = useState("");
  const [addKind, setAddKind] = useState<AiMemoryKind>("preference");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [filter, setFilter] = useState<AiMemoryKind | "all">("all");
  const rows = mem.data ?? [];
  const count = (k: AiMemoryKind) => rows.filter((r) => r.kind === k).length;
  const shown = KINDS.filter((k) => (filter === "all" || filter === k) && count(k) > 0);

  const remove = (r: (typeof rows)[number]) =>
    m.deleteMemory.mutate(r.id, {
      onSuccess: () =>
        toast("Forgotten", { action: { label: "Undo", onClick: () => m.addMemory.mutate({ kind: r.kind, content: r.content }) } }),
      onError: (e) => toast.error((e as Error).message),
    });
  const saveEdit = () => {
    if (!editing) return;
    const content = editing.content.trim();
    if (content) m.updateMemory.mutate({ id: editing.id, content });
    setEditing(null);
  };
  const add = (kind: AiMemoryKind, content: string) => m.addMemory.mutate({ kind, content }, { onSuccess: () => setAdding("") });

  return (
    <Section
      title="Everything remembered"
      collapsible
      defaultOpen
      summary={`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
      description="Edit or remove anything. The assistant uses this to write in your voice."
      actions={
        <div className="flex items-center gap-1.5">
          {rows.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={onClear}>
              <BrandIcon name="trash" size={13} /> Forget all
            </Button>
          )}
        </div>
      }
    >
      <Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Kinds of memory">
            {([["all", "All", rows.length], ...KINDS.map((k) => [k, KIND_LABEL[k], count(k)] as const)] as const).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={filter === k}
                disabled={k !== "all" && n === 0}
                onClick={() => setFilter(k as AiMemoryKind | "all")}
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
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Brain className="mx-auto mb-2 size-5 text-muted-foreground" />
            <div className="text-sm font-medium">Nothing remembered yet</div>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">It learns from the mail you send, and from chats. Or start it off with one of these:</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {KINDS.filter((k) => k !== "profile").map((k) => (
                <Button key={k} size="xs" variant="outline" disabled={m.addMemory.isPending} onClick={() => add(k, KIND_EXAMPLE[k])}>
                  {KIND_ICON[k]} {KIND_EXAMPLE[k]}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {shown.map((k) => (
              <div key={k} className="px-3 py-3 sm:px-4">
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <span className="text-muted-foreground [&>svg]:size-3.5">{KIND_ICON[k]}</span>
                  <h3 className="text-[12.5px] font-semibold">{KIND_LABEL[k]}</h3>
                  <span className="text-xs text-muted-foreground">{KIND_HINT[k]}</span>
                </div>
                <ul className="space-y-0.5">
                  {rows
                    .filter((r) => r.kind === k)
                    .sort((a, b) => b.updated_at - a.updated_at)
                    .map((r) => {
                      const src = SOURCE[r.source] ?? SOURCE.learned;
                      return (
                        <li key={r.id} className="group rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
                          {editing?.id === r.id ? (
                            <div className="space-y-2">
                              <Textarea
                                autoFocus
                                value={editing.content}
                                rows={2}
                                onChange={(e) => setEditing({ id: r.id, content: e.target.value })}
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
                                <p className="text-[13.5px] leading-5 text-foreground">{r.content}</p>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground" title={src.hint}>
                                  <span className="[&>svg]:size-3">{src.icon}</span>
                                  {src.label} · {fmtRelative(r.updated_at)}
                                </div>
                              </div>
                              <div className={cn("flex shrink-0 items-center gap-0.5", !compact && "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100")}>
                                <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-foreground" aria-label="Edit" onClick={() => setEditing({ id: r.id, content: r.content })}>
                                  <Pencil size={12} />
                                </Button>
                                <Button size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Forget this" onClick={() => remove(r)}>
                                  <BrandIcon name="trash" size={12} />
                                </Button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <form
          className="space-y-2.5 border-t border-border bg-muted/20 p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.trim()) add(addKind, adding.trim());
          }}
        >
          <div className="text-[12.5px] font-medium">Add something it should remember</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What kind of note">
            {KINDS.map((k) => (
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
                {KIND_ICON[k]} {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className={cn("flex gap-2", compact ? "flex-col" : "items-center")}>
            <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={`e.g. “${KIND_EXAMPLE[addKind]}”`} className={compact ? "h-11 text-[16px]" : "h-8 flex-1 text-xs"} />
            <Button type="submit" size={compact ? "lg" : "sm"} className="h-8 shrink-0 gap-1.5 text-xs" disabled={!adding.trim() || m.addMemory.isPending}>
              <Plus size={13} /> Remember
            </Button>
          </div>
        </form>
      </Panel>
    </Section>
  );
}
