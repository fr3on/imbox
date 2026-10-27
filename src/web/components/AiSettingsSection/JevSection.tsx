import { useState } from "react";
import { ExternalLink, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { useJev, useJevMutations, type JevCapabilityInfo, type JevSample } from "../../api";
import { fmtRelative } from "../../lib/format";
import { Row, Section } from "../../settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

function CapabilityHint({ c }: { c: JevCapabilityInfo }) {
  return (
    <>
      {c.decides}
      <span className="mt-1 block">
        <span className="text-foreground/80">Sees:</span> {c.sees}
      </span>
      <span className="block">
        <span className="text-foreground/80">Runs:</span> {c.runs}
      </span>
      <span className="mt-1 block tnum">{c.calls_30d ? `Used ${c.calls_30d} time${c.calls_30d === 1 ? "" : "s"} in the last 30 days${c.last_at ? `, last ${fmtRelative(c.last_at)}` : ""}.` : "Not used yet."}</span>
    </>
  );
}

/** Jev, TypeSafe AI's model for quick decisions: the key, the master switch, what it may decide, and a way to see it work on made-up examples. */
export function JevSection({ compact }: { compact?: boolean }) {
  const { data: jev } = useJev();
  const { save, sample } = useJevMutations();
  const [key, setKey] = useState("");
  const [samples, setSamples] = useState<JevSample[] | null>(null);
  if (!jev) return null;
  const onCount = jev.capabilities.filter((c) => c.enabled).length;
  const fail = (e: unknown) => toast.error((e as Error).message);
  const inputCls = compact ? "h-11 w-full text-[16px]" : "w-64 sm:w-80";

  return (
    <Section
      title="Fast decisions"
      collapsible
      summary={!jev.configured ? "Off" : !jev.enabled ? "Key saved, off" : `On, ${onCount} of ${jev.capabilities.length}`}
      description="Quick pick-one and yes-or-no calls from TypeSafe AI's Jev model, answered in a fraction of a second, with how sure it is. Optional, and off until you add a key."
    >
      <Row
        label="Use Jev"
        hint={
          <>
            When on, the parts of a message listed below are sent to TypeSafe AI, which hosts in the United States. It says it does not train on what you send; it does not state how long it keeps it. Jev is in early access. Read their{" "}
            <a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              privacy policy
            </a>
            . Nothing goes to them while this is off.
          </>
        }
      >
        <Switch checked={jev.enabled} disabled={!jev.configured || save.isPending} onCheckedChange={(v) => save.mutate({ enabled: v }, { onError: fail })} aria-label="Use Jev" />
      </Row>

      <Row
        label="TypeSafe API key"
        hint={
          jev.configured ? (
            <>Stored encrypted on your server and never shown again. Ends {jev.key_hint}.</>
          ) : (
            <>
              Make one in the{" "}
              <a href="https://console.typesafe.ai/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">
                TypeSafe console <ExternalLink className="size-3" />
              </a>
              .
            </>
          )
        }
      >
        <form
          className={compact ? "flex w-full flex-col gap-2" : "flex items-center gap-2"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!key.trim()) return;
            save.mutate(
              { api_key: key.trim(), enabled: true },
              {
                onSuccess: () => {
                  setKey("");
                  toast("Key saved. Fast decisions are on.");
                },
                onError: fail,
              },
            );
          }}
        >
          <Input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={jev.configured ? "Paste a new key to replace it" : "Paste your key"} aria-label="TypeSafe API key" className={inputCls} />
          <Button type="submit" size="sm" disabled={!key.trim() || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
          {jev.configured && (
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={save.isPending} onClick={() => save.mutate({ api_key: null }, { onSuccess: () => { setSamples(null); toast("Key removed"); }, onError: fail })}>
              Remove key
            </Button>
          )}
        </form>
      </Row>

      {jev.capabilities.map((c) => (
        <Row key={c.id} label={c.label} hint={<CapabilityHint c={c} />}>
          <Switch
            checked={c.enabled}
            disabled={!jev.enabled || save.isPending}
            onCheckedChange={(v) => save.mutate({ features: { [c.id]: v } }, { onError: fail })}
            aria-label={c.label}
          />
        </Row>
      ))}

      <Row label="See it work" hint="Runs two made-up examples, a phishing-style notice and a newsletter from a new sender, and shows what Jev answers and how fast. None of your mail is sent.">
        <Button
          size="sm"
          variant="outline"
          disabled={(!jev.configured && !key.trim()) || sample.isPending}
          onClick={() =>
            sample.mutate(key.trim() || undefined, {
              onSuccess: (r) => setSamples(r.samples),
              onError: (e) => {
                setSamples(null);
                fail(e);
              },
            })
          }
        >
          {sample.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run a sample
        </Button>
      </Row>
      {samples && (
        <ul className="border-b border-border/60 px-4 pb-4 sm:px-5" aria-live="polite">
          {samples.map((s) => (
            <li key={s.id} className="grid gap-x-4 gap-y-0.5 border-t border-border/60 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.input}</div>
                <div className="mt-0.5 text-[13px] text-foreground">{s.output}</div>
              </div>
              <div className="text-xs text-muted-foreground tnum sm:text-right">
                {s.ms} ms
                <span className="block">{s.tokens} tokens</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
