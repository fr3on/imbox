import { useState } from "react";
import { Check, CircleDashed, Copy, RefreshCw } from "lucide-react";
import type { Domain } from "@shared/types";
import { cn } from "@/lib/utils";
import { useCopy } from "@/lib/useCopy";
import { fmtRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";

type StepKey = "secret" | "mx" | "forward" | "mailbox";

interface Step {
  key: StepKey;
  /** Dot label under the banner, one or two words. */
  short: string;
  title: string;
  done: boolean;
}

/**
 * What can be known: whether the secret is set (the server says so), and whether a message has arrived. The MX records and the forwarding live
 * on the owner's mail server, out of sight, so they count as done only once mail has come through them.
 */
export function stepsFor(d: Domain): Step[] {
  const received = d.inbound.last_received_at != null;
  return [
    { key: "secret", short: "Secret", title: "Set the inbound secret", done: d.inbound.enabled },
    { key: "mx", short: "MX records", title: "Point the MX records", done: received },
    { key: "forward", short: "Forwarding", title: "Forward each message to Imbox", done: received },
    { key: "mailbox", short: "First message", title: "Create a mailbox and send a test", done: received },
  ];
}

function CopyLine({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 py-1 pl-2.5 pr-1">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
      <Button type="button" size="xs" variant="ghost" className="shrink-0 text-muted-foreground" aria-label={`Copy ${label}`} onClick={() => copy(value)}>
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function StepBody({ step, d, onNewMailbox }: { step: StepKey; d: Domain; onNewMailbox: () => void }) {
  if (step === "secret")
    return (
      <div className="space-y-2.5 text-[13px]">
        <p>{d.inbound.enabled ? "INBOUND_SECRET is set on the server." : "Make a secret, add it to the server as INBOUND_SECRET, then restart Imbox. Until then Imbox does not accept mail over HTTP."}</p>
        {!d.inbound.enabled && <CopyLine value="openssl rand -hex 32" label="the command" />}
      </div>
    );
  if (step === "mx")
    return (
      <div className="space-y-2.5 text-[13px]">
        <p>Point the MX records of {d.name} at the mail server that will forward its mail to Imbox.</p>
        <p className="text-muted-foreground">MX records tell the internet where to deliver mail for this domain. You set them where {d.name} is managed.</p>
      </div>
    );
  if (step === "forward")
    return (
      <div className="space-y-3 text-[13px]">
        <p>Have that mail server send each message to Imbox, as an HTTP POST with the raw message as the body.</p>
        <Detail label="Address">
          <CopyLine value={`${d.inbound.url}?to=<recipient>&from=<sender>`} label="the address" />
        </Detail>
        <Detail label="Header">
          <CopyLine value="Authorization: Bearer <your INBOUND_SECRET>" label="the header" />
        </Detail>
      </div>
    );
  const boxes = d.mailboxes.length;
  return (
    <div className="space-y-2.5 text-[13px]">
      <p>{boxes ? `${boxes} mailbox${boxes === 1 ? "" : "es"} on ${d.name}. Send a test message to one.` : "Create a mailbox, or turn on a catch-all below, then send a test message."} This page turns Active when the first one arrives.</p>
      {!boxes && (
        <Button type="button" size="sm" variant="outline" onClick={onNewMailbox}>
          New mailbox
        </Button>
      )}
    </div>
  );
}

/** The receiving set-up for a domain: where it stands, the step to do now, and the steps either side. Gone once mail is arriving. */
export function ReceivingSteps({ d, checking, onCheck, onNewMailbox }: { d: Domain; checking: boolean; onCheck: () => void; onNewMailbox: () => void }) {
  const steps = stepsFor(d);
  const next = steps.findIndex((s) => !s.done);
  const [picked, setPicked] = useState<number | null>(null);
  const received = d.inbound.last_received_at;

  if (next === -1)
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Check size={14} className="shrink-0" />
        <span>Receiving mail{received ? `. Last message ${fmtRelative(received)}` : ""}.</span>
      </div>
    );

  const at = Math.min(picked ?? next, steps.length - 1);
  const cur = steps[at];
  return (
    <section className="space-y-3" aria-label="Set up receiving">
      <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
        <CircleDashed size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Not receiving yet</div>
          <div className="text-xs text-muted-foreground">
            Step {next + 1} of {steps.length}: {steps[next].title.toLowerCase()}.
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" className="shrink-0 text-muted-foreground" disabled={checking} onClick={onCheck}>
          <RefreshCw className={cn(checking && "animate-spin")} /> Check again
        </Button>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">{cur.title}</div>
        <StepBody step={cur.key} d={d} onNewMailbox={onNewMailbox} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="h-px w-3 bg-border" />}
              <button
                type="button"
                onClick={() => setPicked(i)}
                aria-current={i === at ? "step" : undefined}
                className={cn("flex items-center gap-1.5 rounded px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", i === at && "text-foreground")}
              >
                <span aria-hidden className={cn("size-2 rounded-full", s.done ? "bg-foreground" : i === next ? "ring-[1.5px] ring-inset ring-foreground" : "ring-[1.5px] ring-inset ring-muted-foreground")} />
                <span className={cn(i === at && "font-medium")}>{s.short}</span>
                {s.done && <span className="sr-only">(done)</span>}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={at === 0} onClick={() => setPicked(at - 1)}>
            Back
          </Button>
          {at < steps.length - 1 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPicked(at + 1)}>
              Next: {steps[at + 1].short}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
