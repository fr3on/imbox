import { useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { ACTION_TYPES, FIELDS, LIMITS, TRAYS, YES_NO_FIELDS, normalizeWorkflow, type Action, type Condition, type Field, type Trigger } from "@shared/workflows";
import { useAccount } from "../../context/AccountContext";
import { useCollections, useLabels, useWorkflowMutations, useWorkflowPreview, type Workflow, type WorkflowInput } from "../../api";
import { useIsMobile } from "../../hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const FIELD_LABEL: Record<Field, string> = {
  from: "Sender",
  to: "Sent to",
  subject: "Subject",
  body: "Text of the email",
  has_attachment: "Attachment",
  has_unsubscribe: "Mailing list",
  tray: "Tray",
  ai: "AI judges that…",
};
export const TRAY_LABEL: Record<string, string> = { imbox: "Imbox", feed: "Feed", paper_trail: "Paper Trail" };
const ACTION_LABEL: Record<Action["type"], string> = {
  label: "Add a label",
  move: "Move to a tray",
  mark_read: "Mark as read",
  set_aside: "Set aside",
  reply_later: "Add to Reply Later",
  snooze: "Snooze",
  collection: "Add to a collection",
};
const SNOOZE: [number, string][] = [
  [1, "1 hour"],
  [3, "3 hours"],
  [24, "tomorrow"],
  [72, "3 days"],
  [168, "a week"],
  [720, "a month"],
];

/** Starting points offered when a workflow is made. Only the name is asked for; a template fills in the rest, which can be changed on the workflow's page. */
export const TEMPLATES: { label: string; blurb: string; def: WorkflowInput }[] = [
  {
    label: "Newsletters to the Feed",
    blurb: "Mailing lists go to the Feed and are marked read.",
    def: { name: "Newsletters to the Feed", conditions: [{ field: "has_unsubscribe", op: "is", value: "true" }], actions: [{ type: "move", tray: "feed" }, { type: "mark_read" }] },
  },
  {
    label: "Receipts to Paper Trail",
    blurb: "Mail about receipts, invoices and orders goes to Paper Trail.",
    def: {
      name: "Receipts to Paper Trail",
      match: "any",
      conditions: [
        { field: "subject", op: "contains", value: "receipt" },
        { field: "subject", op: "contains", value: "invoice" },
        { field: "subject", op: "contains", value: "order confirmation" },
      ],
      actions: [{ type: "move", tray: "paper_trail" }],
    },
  },
  {
    label: "Follow up after 3 days",
    blurb: "A thread you wrote that gets no answer comes back in Reply Later.",
    def: { name: "Follow up after 3 days", trigger: "no_reply", trigger_days: 3, conditions: [], actions: [{ type: "reply_later" }] },
  },
];

const AI_PER_MINUTE = 10;

const selectCls = "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Step({ n, title, summary, open, onToggle, children, last }: { n: number; title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-3">
      {!last && <span aria-hidden className="absolute left-[13px] top-8 bottom-[-12px] w-px bg-border" />}
      <span className="relative z-10 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">{n}</span>
      <div className="min-w-0 flex-1 rounded-lg border border-border">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{title}</span>
            {!open && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
          </span>
          <ChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && <div className="space-y-3 border-t border-border/60 px-3 py-3">{children}</div>}
      </div>
    </li>
  );
}

/**
 * The steps of one workflow, on its own page: when, if, then, where. A workflow that is off may be unfinished and can be saved as it is;
 * one that is on has to be whole, so what is missing is said before Save.
 */
export function WorkflowForm({ workflow }: { workflow: Workflow }) {
  const mobile = useIsMobile();
  const { accounts } = useAccount();
  const { update } = useWorkflowMutations();
  const preview = useWorkflowPreview();
  const labels = useLabels();
  const collections = useCollections();
  const boxes = accounts.filter((a) => !a.is_agent);

  const [name, setName] = useState(workflow.name);
  const [trigger, setTrigger] = useState<Trigger>(workflow.trigger);
  const [days, setDays] = useState(workflow.trigger_days);
  const [match, setMatch] = useState<"all" | "any">(workflow.match);
  const [conditions, setConditions] = useState<Condition[]>(workflow.conditions);
  const [actions, setActions] = useState<Action[]>(workflow.actions);
  const [ids, setIds] = useState<string[]>(workflow.account_ids);
  const [limit, setLimit] = useState(workflow.daily_limit);
  // Nothing to fold away yet on a new one; on a finished one the steps are folded to a line each on a phone.
  const empty = workflow.conditions.length === 0 && workflow.actions.length === 0;
  const [openSteps, setOpenSteps] = useState<number[]>(mobile && !empty ? [] : [1, 2, 3, 4]);
  const toggle = (n: number) => setOpenSteps((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n]));

  const labelList = labels.data ?? [];
  const collectionList = collections.data ?? [];
  const emailOf = (id: string) => boxes.find((a) => a.id === id)?.email ?? "";
  const targets = (actions.filter((a) => (a.type === "label" || a.type === "collection") && a.id) as Action[]).map((a) => (a.type === "label" ? labelList : collectionList).find((x) => x.id === a.id)?.account_id).filter(Boolean) as string[];
  const targetBoxes = [...new Set(targets)];
  // A label or collection belongs to one mailbox, so a workflow that uses one works on that mailbox only.
  const effectiveIds = targetBoxes.length === 1 ? targetBoxes : ids;
  const crossBox = targetBoxes.length > 1;

  const body: WorkflowInput = { name, trigger, trigger_days: days, match, conditions, actions, account_ids: effectiveIds, daily_limit: limit };
  const saved = JSON.stringify([workflow.name, workflow.trigger, workflow.trigger_days, workflow.match, workflow.conditions, workflow.actions, workflow.account_ids, workflow.daily_limit]);
  const dirty = JSON.stringify([name, trigger, days, match, conditions, actions, effectiveIds, limit]) !== saved;
  const whole = useMemo(() => normalizeWorkflow(body), [name, trigger, days, match, conditions, actions, effectiveIds.join(), limit]); // eslint-disable-line react-hooks/exhaustive-deps
  const wholeProblem = "error" in whole ? whole.error : "";
  // On: it has to be whole. Off: a name is enough.
  const problem = crossBox ? "Labels and collections from different mailboxes can't be in one workflow." : !name.trim() ? "Give the workflow a name." : workflow.enabled ? wholeProblem : "";

  const setCond = (i: number, c: Condition) => setConditions((cur) => cur.map((x, j) => (j === i ? c : x)));
  const setAct = (i: number, a: Action) => setActions((cur) => cur.map((x, j) => (j === i ? a : x)));
  const newCondition = (field: Field): Condition => ({ field, op: field === "tray" || field === "ai" || YES_NO_FIELDS.includes(field) ? "is" : "contains", value: field === "tray" ? "feed" : YES_NO_FIELDS.includes(field) ? "true" : "" });

  const save = () => update.mutate({ id: workflow.id, ...body }, { onSuccess: () => toast("Workflow saved"), onError: (e) => toast.error((e as Error).message) });

  const summaries = {
    1: trigger === "no_reply" ? `A thread I wrote has no reply for ${days} day${days === 1 ? "" : "s"}` : "Mail arrives",
    2: conditions.length ? `${match === "all" ? "All" : "Any"} of ${conditions.length} condition${conditions.length === 1 ? "" : "s"}` : trigger === "no_reply" ? "Any thread" : "Add a condition",
    3: actions.map((a) => ACTION_LABEL[a.type]).join(", ") || "Add an action",
    4: effectiveIds.length ? effectiveIds.map(emailOf).filter(Boolean).join(", ") || "Chosen mailboxes" : "All mailboxes",
  };
  const inputCls = cn("w-full", mobile && "h-11 text-[16px]");
  const sel = cn(selectCls, mobile && "h-11 text-[16px]");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="wf-name" className="text-sm font-medium">Name</label>
        <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} placeholder="Newsletters to the Feed" className={inputCls} />
      </div>

      <ol className="space-y-3">
        <Step n={1} title="When" summary={summaries[1]} open={openSteps.includes(1)} onToggle={() => toggle(1)}>
          <select aria-label="Trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as Trigger)} className={sel}>
            <option value="message_arrives">New mail arrives</option>
            <option value="no_reply">A thread I wrote has had no reply</option>
          </select>
          {trigger === "no_reply" ? (
            <label className="flex items-center gap-2 text-sm">
              <span>For at least</span>
              <Input type="number" min={1} max={LIMITS.maxDays} value={days} onChange={(e) => setDays(Number(e.target.value))} className={cn("w-20", mobile && "h-11 text-[16px]")} aria-label="Days without a reply" />
              <span>days</span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">It looks at new mail from the people you've let in. Mail waiting in the Screener is left for you to decide.</p>
          )}
        </Step>

        <Step n={2} title="If" summary={summaries[2]} open={openSteps.includes(2)} onToggle={() => toggle(2)}>
          {conditions.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span>It matches</span>
              <select aria-label="All or any" value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className={cn(sel, "w-auto")}>
                <option value="all">all of these</option>
                <option value="any">any of these</option>
              </select>
            </label>
          )}
          {conditions.map((c, i) => (
            <div key={i} className="rounded-md bg-muted/40 p-2">
              <div className="flex items-center gap-2">
                <select aria-label="What to look at" value={c.field} onChange={(e) => setCond(i, newCondition(e.target.value as Field))} className={sel}>
                  {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                </select>
                <button type="button" aria-label="Remove condition" onClick={() => setConditions((cur) => cur.filter((_, j) => j !== i))} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X size={16} /></button>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                {YES_NO_FIELDS.includes(c.field) ? (
                  <select aria-label="Value" value={c.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} className={sel}>
                    <option value="true">{c.field === "has_attachment" ? "Has an attachment" : "Is a mailing list"}</option>
                    <option value="false">{c.field === "has_attachment" ? "Has no attachment" : "Is not a mailing list"}</option>
                  </select>
                ) : c.field === "ai" ? (
                  <div className="w-full space-y-1.5">
                    <label className="flex flex-col gap-1.5 text-sm sm:flex-row sm:items-center sm:gap-2">
                      <span className="shrink-0">The AI judges that this email</span>
                      <Input aria-label="What the AI should decide" value={c.value} maxLength={LIMITS.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} placeholder="is a receipt" className={inputCls} />
                    </label>
                    <p className="text-xs text-muted-foreground">Asked last, only about mail the other conditions let through, and at most {AI_PER_MINUTE} times a minute. Uses your AI provider. It answers yes or no and can't change what the workflow does.</p>
                  </div>
                ) : c.field === "tray" ? (
                  <>
                    <select aria-label="Is or is not" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as Condition["op"] })} className={cn(sel, "sm:w-32")}>
                      <option value="is">is in</option>
                      <option value="not_contains">is not in</option>
                    </select>
                    <select aria-label="Tray" value={c.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} className={sel}>
                      {TRAYS.map((t) => <option key={t} value={t}>{TRAY_LABEL[t]}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <select aria-label="How to match" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as Condition["op"] })} className={cn(sel, "sm:w-40")}>
                      <option value="contains">contains</option>
                      <option value="not_contains">does not contain</option>
                      <option value="is">is</option>
                    </select>
                    <Input aria-label="Value" value={c.value} maxLength={LIMITS.value} onChange={(e) => setCond(i, { ...c, value: e.target.value })} placeholder={c.field === "from" ? "news@shop.com or shop.com" : "words to look for"} className={inputCls} />
                  </>
                )}
              </div>
            </div>
          ))}
          {conditions.length < LIMITS.conditions && (
            <Button type="button" size={mobile ? "lg" : "sm"} variant="outline" onClick={() => setConditions((cur) => [...cur, newCondition("from")])}><Plus /> Add a condition</Button>
          )}
          {trigger === "message_arrives" && conditions.length === 0 && <p className="text-xs text-muted-foreground">Add at least one condition, or the workflow would touch every email.</p>}
        </Step>

        <Step n={3} title="Then" summary={summaries[3]} open={openSteps.includes(3)} onToggle={() => toggle(3)}>
          {actions.map((a, i) => (
            <div key={i} className="rounded-md bg-muted/40 p-2">
              <div className="flex items-center gap-2">
                <select aria-label="Action" value={a.type} onChange={(e) => setAct(i, { type: e.target.value as Action["type"], ...(e.target.value === "move" ? { tray: "feed" as const } : e.target.value === "snooze" ? { hours: 24 } : {}) })} className={sel}>
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
                </select>
                <button type="button" aria-label="Remove action" onClick={() => setActions((cur) => cur.filter((_, j) => j !== i))} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X size={16} /></button>
              </div>
              {a.type === "move" && (
                <select aria-label="Tray" value={a.tray ?? "feed"} onChange={(e) => setAct(i, { ...a, tray: e.target.value as Action["tray"] })} className={cn(sel, "mt-2")}>
                  {TRAYS.map((t) => <option key={t} value={t}>{TRAY_LABEL[t]}</option>)}
                </select>
              )}
              {a.type === "snooze" && (
                <select aria-label="Snooze for" value={a.hours ?? 24} onChange={(e) => setAct(i, { ...a, hours: Number(e.target.value) })} className={cn(sel, "mt-2")}>
                  {SNOOZE.map(([h, l]) => <option key={h} value={h}>Back in {l}</option>)}
                </select>
              )}
              {(a.type === "label" || a.type === "collection") && (
                <select aria-label={a.type === "label" ? "Label" : "Collection"} value={a.id ?? ""} onChange={(e) => setAct(i, { ...a, id: e.target.value })} className={cn(sel, "mt-2")}>
                  <option value="">{a.type === "label" ? "Pick a label" : "Pick a collection"}</option>
                  {(a.type === "label" ? labelList : collectionList).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}{boxes.length > 1 ? ` · ${emailOf(x.account_id)}` : ""}</option>
                  ))}
                </select>
              )}
              {(a.type === "label" || a.type === "collection") && (a.type === "label" ? labelList : collectionList).length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">You have no {a.type === "label" ? "labels" : "collections"} yet. Make one first, then come back.</p>
              )}
            </div>
          ))}
          {actions.length < LIMITS.actions && (
            <Button type="button" size={mobile ? "lg" : "sm"} variant="outline" onClick={() => setActions((cur) => [...cur, { type: "mark_read" }])}><Plus /> Add an action</Button>
          )}
        </Step>

        <Step n={4} title="Where and how much" summary={summaries[4]} open={openSteps.includes(4)} onToggle={() => toggle(4)} last>
          <div className="space-y-1.5">
            <div className="text-[13px] text-muted-foreground">Mailboxes it works on</div>
            {targetBoxes.length === 1 ? (
              <p className="text-xs text-muted-foreground">Labels and collections belong to one mailbox, so this workflow works on {emailOf(targetBoxes[0])} only.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {boxes.map((a) => {
                    const on = ids.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setIds((cur) => (on ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                        className={cn("max-w-full truncate rounded-full border px-2.5 py-1.5 text-xs transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                      >
                        {a.email}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{ids.length ? "Only the mailboxes you picked." : "None picked means all of them."}</p>
              </>
            )}
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Most conversations per day</span>
            <Input type="number" min={1} max={LIMITS.maxDaily} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={cn("w-24", mobile && "h-11 text-[16px]")} />
          </label>
        </Step>
      </ol>

      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <div className="text-sm font-medium">Try it on my recent mail</div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size={mobile ? "lg" : "sm"} variant="outline" disabled={!!wholeProblem || crossBox || preview.isPending} onClick={() => preview.mutate(body, { onError: (e) => toast.error((e as Error).message) })}>
            {preview.isPending ? <Loader2 className="animate-spin" /> : null} Check my latest mail
          </Button>
          <span className="text-xs text-muted-foreground">{wholeProblem ? wholeProblem : "Nothing is changed."}</span>
        </div>
        {preview.data && (
          <div role="status" className="rounded-md border border-border bg-background p-2.5 text-[13px]">
            {preview.data.ai_skipped && <p className="mb-1.5 text-xs text-muted-foreground">The AI condition isn't applied in this check, so the real count can be lower.</p>}
            {preview.data.total === 0 ? (
              <span>None of your last {preview.data.scanned} messages would match.</span>
            ) : (
              <>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{preview.data.total} conversation{preview.data.total === 1 ? "" : "s"} in your last {preview.data.scanned} messages would match{preview.data.total > preview.data.matches.length ? `, here are ${preview.data.matches.length}` : ""}:</div>
                <ul className="divide-y divide-border/60">
                  {preview.data.matches.map((m) => (
                    <li key={m.thread_id} className="py-1.5">
                      <div className="truncate">{m.subject || "(no subject)"}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.from}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {problem && <p role="alert" className="text-xs text-muted-foreground">{problem}</p>}
      <div className="flex items-center gap-3">
        <Button size={mobile ? "lg" : "default"} onClick={save} disabled={!dirty || !!problem || update.isPending}>
          {update.isPending ? <Loader2 className="animate-spin" /> : null} Save changes
        </Button>
        {!dirty && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>
    </div>
  );
}
