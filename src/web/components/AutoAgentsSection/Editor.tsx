import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "../../context/AccountContext";
import type { AutoAgent, AutoAgentInput } from "../../api";
import { useAutoAgentMutations, useTryAgent } from "../../api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATES } from "./templates";

export function Editor({ agent, open, onClose }: { agent: AutoAgent | null; open: boolean; onClose: () => void }) {
  const { accounts } = useAccount();
  const { create, update } = useAutoAgentMutations();
  const boxes = accounts.filter((a) => !a.is_agent);
  const [name, setName] = useState(agent?.name ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [ids, setIds] = useState<string[]>(agent?.account_ids ?? []);
  const [mode, setMode] = useState<"draft" | "auto">(agent?.mode ?? "draft");
  const [screened, setScreened] = useState(agent?.only_screened_in ?? true);
  const [senders, setSenders] = useState(agent?.senders ?? "");
  const [limit, setLimit] = useState(agent?.daily_limit ?? 20);
  const [understood, setUnderstood] = useState(agent?.mode === "auto");
  const trial = useTryAgent();
  const [sample, setSample] = useState("Hi, I can’t sign in since this morning. Can you help?");
  const busy = create.isPending || update.isPending;
  const ready = name.trim() && ids.length > 0 && (mode === "draft" || understood);

  const save = () => {
    const body: AutoAgentInput = { name, instructions, account_ids: ids, mode, only_screened_in: screened, senders, daily_limit: limit };
    const done = { onSuccess: () => { toast(agent ? "Agent saved" : "Agent created. Switch it on when you're ready."); onClose(); }, onError: (e: unknown) => toast.error((e as Error).message) };
    if (agent) update.mutate({ id: agent.id, ...body }, done);
    else create.mutate(body, done);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{agent ? "Edit agent" : "New agent"}</DialogTitle>
          <DialogDescription>It reads new mail in the mailboxes you choose and follows your instructions. It only ever replies to the person who wrote.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="min-w-0 space-y-5 md:border-r md:border-border md:pr-6">
            <div className="space-y-1.5">
              <label htmlFor="ag-name" className="text-sm font-medium">Name</label>
              <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Scheduling assistant" maxLength={60} />
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium">Mailboxes it watches</div>
              {boxes.length === 0 && <div className="text-xs text-muted-foreground">No mailboxes yet.</div>}
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                {boxes.map((a) => {
                  const on = ids.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setIds((cur) => (on ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                      className={cn("max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                    >
                      {a.email}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">What it does with a reply</div>
              {([
                ["draft", "Write a draft for me to review", "Recommended. The reply waits in Drafts and in your notifications until you send it."],
                ["auto", "Send replies by itself", "Replies go out from your address without you seeing them first, marked as automatic."],
              ] as const).map(([v, title, hint]) => (
                <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", mode === v ? "border-foreground" : "border-border hover:bg-muted/40")}>
                  <input type="radio" name="ag-mode" checked={mode === v} onChange={() => setMode(v)} className="mt-1 accent-foreground" />
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
              {mode === "auto" && (
                <label className="flex items-start gap-2.5 rounded-lg bg-muted/50 p-3 text-xs leading-5">
                  <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} className="mt-0.5" />
                  <span>I understand it will send replies without asking me. It cannot forward, delete or contact anyone but the sender, and it stops at the daily limit below.</span>
                </label>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Which mail</div>
              <label className="flex items-center justify-between gap-3 text-[13px]">
                <span>Only people I have screened in</span>
                <Switch checked={screened} onCheckedChange={setScreened} />
              </label>
              <div className="space-y-1.5">
                <label htmlFor="ag-senders" className="text-[13px]">Only these senders <span className="text-muted-foreground">· optional</span></label>
                <Input id="ag-senders" value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="acme.io, pat@example.com" />
                <p className="text-xs text-muted-foreground">Addresses or domains. Leave empty for everyone who passes the rule above.</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="ag-limit" className="text-[13px]">Replies per day at most</label>
                <Input id="ag-limit" type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-24" />
              </div>
              <p className="text-xs text-muted-foreground">It always skips newsletters, no-reply addresses, automatic replies and mail older than a day, and answers a thread at most twice.</p>
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="ag-inst" className="text-sm font-medium">Instructions</label>
              <span className="flex gap-1">
                {TEMPLATES.map((t) => (
                  <button key={t.label} type="button" onClick={() => setInstructions(t.text)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground">{t.label}</button>
                ))}
              </span>
            </div>
            <Textarea id="ag-inst" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={14} maxLength={4000} className="min-h-64" placeholder="Say what it is for, what it may answer, what it must never do, and when to leave a thread for you." />
            <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <p>Write it like a note to a new assistant. It sees your instructions and the email, nothing else, and treats the email as untrusted text.</p>
              <span className="shrink-0 tnum">{instructions.length} / 4000</span>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <div className="text-sm font-medium">Try it</div>
              <Textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={2} maxLength={2000} aria-label="Sample email" placeholder="Paste a sample email" className="bg-background" />
              <div className="flex items-center gap-3">
                <Button type="button" size="sm" variant="outline" disabled={!sample.trim() || trial.isPending} onClick={() => trial.mutate({ name, instructions, sample }, { onError: (e) => toast.error((e as Error).message) })}>
                  {trial.isPending ? <Loader2 className="animate-spin" /> : null} Run on this sample
                </Button>
                <span className="text-xs text-muted-foreground">Nothing is sent or saved.</span>
              </div>
              {trial.data && (
                <div className="rounded-md border border-border bg-background p-2.5 text-[13px]" role="status">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{trial.data.action === "reply" ? "It would reply:" : "It would leave this one for you:"}</div>
                  <div className="whitespace-pre-wrap">{trial.data.text}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!ready || busy}>{busy ? <Loader2 className="animate-spin" /> : null} {agent ? "Save" : "Create agent"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
