import { BrandIcon } from "@/components/BrandIcons";
import { useEffect, useState } from "react";
import { Bot, Check, Copy, Eye, EyeOff, Loader2, Mail, Pencil, Plus, RefreshCw } from "lucide-react";
import type { StalwartDomain, StalwartMailboxCreated } from "@shared/types";
import { cn } from "@/lib/utils";
import { useStalwartMutations } from "@/api";
import { useCopy } from "@/lib/useCopy";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { MIN_MAILBOX_PASSWORD, generatePassword, passwordStrength, validLocalPart } from "@shared/mailbox";
import { Switch } from "@/components/ui/switch";
import { ErrorLine, errText } from "./parts";

const STRENGTH_BAR = ["", "bg-destructive", "bg-foreground/40", "bg-foreground/70", "bg-foreground"];

function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1 w-7 rounded-full bg-border transition-colors", score >= i && STRENGTH_BAR[score])} />
        ))}
      </div>
      <span className="min-w-16 text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function CreateMailboxForm({
  serverId,
  domains,
  onCreated,
  onCancel,
}: {
  serverId: string;
  domains: StalwartDomain[];
  onCreated: (r: StalwartMailboxCreated) => void;
  onCancel?: () => void;
}) {
  const { createMailbox } = useStalwartMutations(serverId);
  const { copied, copy } = useCopy();
  const usable = domains.filter((d) => d.isEnabled);
  const [name, setName] = useState("");
  const [domainId, setDomainId] = useState(usable[0]?.id ?? "");
  const [display, setDisplay] = useState("");
  const [mode, setMode] = useState<"generate" | "own">("generate");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [agent, setAgent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!domainId && usable[0]) setDomainId(usable[0].id);
  }, [domainId, usable]);

  const domain = usable.find((d) => d.id === domainId);
  const nameOk = validLocalPart(name);
  const nameBad = name.length > 0 && !nameOk;
  const passOk = mode === "generate" || password.length >= MIN_MAILBOX_PASSWORD;
  const ready = nameOk && !!domain && passOk;

  const submit = () => {
    setErr("");
    createMailbox.mutate(
      { name, domain_id: domainId, display_name: display.trim() || undefined, password: mode === "own" ? password : undefined, agent: agent || undefined },
      { onSuccess: onCreated, onError: (e) => setErr(errText(e)) }
    );
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !createMailbox.isPending) submit();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="mb-name">Email address</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="mb-name"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              placeholder="you"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={nameBad}
              aria-describedby="mb-name-hint"
            />
            <InputGroupAddon align="inline-end">
              {/* Stops the addon's click-to-focus-the-input from stealing focus from the select. */}
              <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <span className="text-muted-foreground">@</span>
                {usable.length > 1 ? (
                  <select aria-label="Domain" value={domainId} onChange={(e) => setDomainId(e.target.value)} className="cursor-pointer bg-transparent pr-1 text-sm text-foreground outline-none">
                    {usable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : (
                  <span className="text-sm text-foreground">{usable[0]?.name}</span>
                )}
              </span>
            </InputGroupAddon>
          </InputGroup>
          <div id="mb-name-hint" className={cn("flex items-center gap-1.5 text-xs", nameBad ? "text-destructive" : "text-muted-foreground")}>
            {nameBad ? (
              "Use letters, digits and . _ + - — starting and ending with a letter or digit."
            ) : nameOk && domain ? (
              <>
                <Mail size={12} className="shrink-0" /> Creates <span className="font-medium text-foreground break-all">{name}@{domain.name}</span>
              </>
            ) : (
              "The part before the @ — for example your first name."
            )}
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="mb-display">Display name <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span></FieldLabel>
          <Input id="mb-display" value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="Shown on messages you send" autoComplete="off" />
        </Field>

        <Field orientation="horizontal">
          <Switch id="mb-agent" checked={agent} onCheckedChange={setAgent} />
          <div>
            <FieldLabel htmlFor="mb-agent" className="flex items-center gap-1.5"><Bot size={14} /> This mailbox is for an AI agent</FieldLabel>
            <FieldDescription>Agents use it through an API key instead of the app. Its mail stays out of your own inbox, and you set up the key next.</FieldDescription>
          </div>
        </Field>

        <Field>
          <FieldLabel>Password</FieldLabel>
          <div role="tablist" aria-label="How to set the password" className="inline-flex w-max rounded-md bg-muted p-0.5 text-[13px]">
            {([["generate", "Generate for me", <BrandIcon name="assistant" key="g" size={13} />], ["own", "I'll choose one", <Pencil key="o" size={13} />]] as const).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1 transition-colors", mode === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {mode === "generate" ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-[13px] leading-5 text-muted-foreground">
              Imbox creates a strong 24-character password and shows it once, right after the mailbox is ready. Recommended.
            </p>
          ) : (
            <div className="grid gap-2">
              <InputGroup>
                <InputGroupInput
                  id="mb-pass"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-describedby="mb-pass-hint"
                />
                <InputGroupAddon align="inline-end">
                  {password ? (
                    <InputGroupButton size="icon-xs" aria-label="Copy password" onClick={() => copy(password)}>
                      {copied ? <Check /> : <Copy />}
                    </InputGroupButton>
                  ) : null}
                  <InputGroupButton size="icon-xs" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                    {show ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StrengthMeter password={password} />
                <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onClick={() => { setPassword(generatePassword(16)); setShow(true); }}>
                  <RefreshCw /> Suggest one
                </Button>
              </div>
              <div id="mb-pass-hint" className={cn("flex items-center gap-1.5 text-xs", password.length >= MIN_MAILBOX_PASSWORD ? "text-foreground" : "text-muted-foreground")}>
                {password.length >= MIN_MAILBOX_PASSWORD ? <Check size={12} /> : <span className="grid size-3 place-items-center">•</span>}
                At least {MIN_MAILBOX_PASSWORD} characters. Imbox won't show it again, so keep a copy.
              </div>
            </div>
          )}
        </Field>
      </FieldGroup>

      {err ? <ErrorLine>{err}</ErrorLine> : null}

      <div className="flex items-center justify-end gap-2">
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" disabled={!ready || createMailbox.isPending}>
          {createMailbox.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Create mailbox
        </Button>
      </div>
    </form>
  );
}
