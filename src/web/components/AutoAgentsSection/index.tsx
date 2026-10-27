import { BrandIcon } from "../BrandIcons";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Bot, Brain, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "../../context/AccountContext";
import {
  useAiSettings,
  useAutoAgentMutations,
  useAutoAgents,
  type AutoAgent,
} from "../../api";
import { Danger, Section } from "../../settings/parts";
import { fmtRelative } from "../../lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ActivityPage, RunLine } from "./ActivityPage";
import { AgentMemoryPage } from "./AgentMemoryPage";
import { Editor } from "./Editor";

export { ActivityPage, RunLine };
export { AgentMemoryPage };
export { Editor };
export {
  TEMPLATES,
  STATUS,
  AGENT_MEMORY_KINDS,
  KIND_LABEL,
  KIND_PLACEHOLDER,
  MEMORY_TEMPLATES,
  AGENT_KIND_ICON,
  AGENT_KIND_HINT,
} from "./templates";

export function AutoAgentsSection() {
  const [sp, setSp] = useSearchParams();
  const list = useAutoAgents();
  const ai = useAiSettings();
  const { update, remove } = useAutoAgentMutations();
  const { accounts } = useAccount();
  const [editing, setEditing] = useState<AutoAgent | "new" | null>(null);
  const [activity, setActivity] = useState<AutoAgent | null>(null);
  const [memoryAgent, setMemoryAgent] = useState<AutoAgent | null>(null);
  const [del, setDel] = useState<AutoAgent | null>(null);
  const agents = list.data ?? [];
  const configured = ai.data?.configured !== false;
  const name = (id: string) => accounts.find((a) => a.id === id)?.email ?? "a mailbox that is gone";

  const agId = sp.get("agent");
  const view = sp.get("view");

  const effectiveMemoryAgent =
    memoryAgent ?? (view === "memory" && agId ? agents.find((x) => x.id === agId) ?? null : null);
  const effectiveActivity =
    activity ?? (view === "activity" && agId ? agents.find((x) => x.id === agId) ?? null : null);

  useEffect(() => {
    if (agId && agents.length) {
      const found = agents.find((x) => x.id === agId);
      if (found) {
        if (view === "memory") {
          setMemoryAgent(found);
          setActivity(null);
        } else if (view === "activity") {
          setActivity(found);
          setMemoryAgent(null);
        }
      }
    }
  }, [agId, view, agents]);

  if (agId && (view === "memory" || view === "activity") && list.isLoading) {
    return (
      <Section
        title="Agent"
        description="Loading…"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSp(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.delete("agent");
                  next.delete("view");
                  return next;
                },
                { replace: true }
              );
            }}
          >
            <ArrowLeft /> Agents
          </Button>
        }
      >
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-2 animate-spin" size={20} />
          <span>Opening agent {view}…</span>
        </div>
      </Section>
    );
  }

  if (effectiveActivity) {
    return (
      <ActivityPage
        key={effectiveActivity.id}
        agent={effectiveActivity}
        onBack={() => {
          setActivity(null);
          setSp(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete("agent");
              next.delete("view");
              return next;
            },
            { replace: true }
          );
        }}
      />
    );
  }

  if (effectiveMemoryAgent) {
    return (
      <AgentMemoryPage
        key={effectiveMemoryAgent.id}
        agent={effectiveMemoryAgent}
        onBack={() => {
          setMemoryAgent(null);
          setSp(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete("agent");
              next.delete("view");
              return next;
            },
            { replace: true }
          );
        }}
      />
    );
  }

  return (
    <Section
      title="Agents"
      collapsible
      defaultOpen
      summary={agents.length === 0 ? "None yet" : `${agents.length} agent${agents.length === 1 ? "" : "s"}, ${agents.filter((a) => a.enabled).length} running`}
      description="An agent watches mailboxes and handles new mail on its own, following instructions you write: drafting or sending replies, and organising threads. This is separate from API access for outside agents, which you set up under Servers."
      actions={<Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus /> New agent</Button>}
    >
      {!configured && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] sm:mx-5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>Agents use your AI provider, and none is set up yet. <Link to="/settings/ai" className="underline underline-offset-2">Set it up under AI</Link> first.</span>
        </div>
      )}

      {list.isLoading ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto animate-spin text-muted-foreground" size={16} /></div>
      ) : agents.length === 0 ? (
        <div className="mx-4 my-3 rounded-lg border border-dashed border-border px-4 py-10 text-center sm:mx-5">
          <Bot className="mx-auto mb-2 text-muted-foreground" size={20} />
          <div className="text-sm font-medium">No agents yet</div>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">Try one that handles meeting requests, or answers the same customer questions. It starts by writing drafts for you to check.</p>
          <Button size="sm" className="mt-4" onClick={() => setEditing("new")}><Plus /> New agent</Button>
        </div>
      ) : (
        <ul className="space-y-3 px-4 py-3 sm:px-5">
          {agents.map((a) => (
            <li key={a.id} className="rounded-lg border border-border">
              <div className="flex items-start gap-3 p-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70"><Bot size={15} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", a.mode === "auto" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>
                      {a.mode === "auto" ? "Sends by itself" : "Drafts for review"}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", a.enabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{a.enabled ? "Running" : "Off"}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.account_ids.length === 0 ? "No mailbox chosen" : a.account_ids.map(name).join(", ")}
                  </div>
                  <div className="mt-1.5 h-1 max-w-56 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${a.replies_today} of ${a.daily_limit} replies today`}>
                    <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, Math.round((a.replies_today / Math.max(1, a.daily_limit)) * 100))}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tnum">
                    {a.replies_today} of {a.daily_limit} replies today{a.last_run_at ? ` · looked ${fmtRelative(a.last_run_at)}` : a.enabled ? " · waiting for new mail" : ""}
                  </div>
                </div>
                <Switch
                  checked={a.enabled}
                  aria-label={a.enabled ? "Switch off" : "Switch on"}
                  onCheckedChange={(v) => update.mutate({ id: a.id, enabled: v }, { onSuccess: () => toast(v ? `${a.name} is on. It will handle mail that arrives from now.` : `${a.name} is off`), onError: (e) => toast.error((e as Error).message) })}
                />
              </div>
              {a.recent.length > 0 && <ul className="mx-3 divide-y divide-border/60 border-t border-border/60">{a.recent.map((r) => <RunLine key={r.id} r={r} />)}</ul>}
              <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setEditing(a)}><Pencil /> Edit</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => {
                    setActivity(a);
                    setMemoryAgent(null);
                    setSp((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("agent", a.id);
                      next.set("view", "activity");
                      return next;
                    }, { replace: true });
                  }}
                >
                  Activity
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => {
                    setMemoryAgent(a);
                    setActivity(null);
                    setSp((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("agent", a.id);
                      next.set("view", "memory");
                      return next;
                    }, { replace: true });
                  }}
                >
                  <Brain size={14} className="mr-1.5" /> Memory
                  {a.memory_count ? (
                    <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tnum">
                      {a.memory_count}
                    </span>
                  ) : null}
                </Button>
                <span className="flex-1" />
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="Delete agent" onClick={() => setDel(a)}><BrandIcon name="trash" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <Editor key={editing === "new" ? "new" : editing.id} agent={editing === "new" ? null : editing} open onClose={() => setEditing(null)} />}
      <Danger
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete ${del?.name ?? "agent"}?`}
        body="It stops watching mail and its activity history is removed. Drafts it already wrote stay in Drafts, and anything it sent stays sent."
        action="Delete agent"
        onConfirm={() => del && remove.mutate(del.id, { onSuccess: () => toast("Agent deleted"), onError: (e) => toast.error((e as Error).message) })}
      />
    </Section>
  );
}
