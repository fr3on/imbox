import { useState } from "react";
import { toast } from "sonner";
import { useExtensionTokenMutations, useExtensionTokens } from "@/api";
import { fmtRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Row, Section } from "../parts";

/** Tokens for the browser extension: made here, shown once, and removed here. A token reads the counts and the Screener queue, and decides about senders. */
export function ExtensionSection() {
  const list = useExtensionTokens();
  const { create, remove } = useExtensionTokenMutations();
  const [name, setName] = useState("");
  // The token that was just made. It is only ever shown here, so it is held until the person has copied it.
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast("Copied"), () => toast.error("Couldn’t copy. Select it and copy by hand."));
  const make = () =>
    create.mutate(
      { name: name.trim() || "Browser extension" },
      {
        onSuccess: (t) => {
          setFresh({ name: t.name, token: t.token });
          setName("");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  const tokens = list.data ?? [];
  return (
    <Section title="Browser extension" collapsible summary={tokens.length === 0 ? "No tokens" : `${tokens.length} token${tokens.length === 1 ? "" : "s"}`} description="A small extension shows the Screener count on the toolbar and lets you decide about senders from any tab. It signs in with a token that can do those things, list the latest few Imbox threads, and list the next days of your calendar, and nothing else.">
      <Row label="Server address" hint="Paste this into the extension with a token.">
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-xs">{location.origin}</code>
          <Button variant="outline" size="sm" onClick={() => copy(location.origin)}>Copy</Button>
        </div>
      </Row>
      <Row label="New token" hint="Give it the name of the browser it is for.">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); make(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chrome on my laptop" aria-label="Token name" className="h-8 w-48" maxLength={60} />
          <Button type="submit" size="sm" disabled={create.isPending || tokens.length >= 10}>Make a token</Button>
        </form>
      </Row>
      {fresh && (
        <div className="mx-4 my-3 sm:mx-5 rounded-xl border border-border bg-muted/40 p-3" role="status">
          <div className="text-[13px] font-medium">Token for {fresh.name}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Copy it now. It is not shown again, and if you lose it you can make another and remove this one.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all truncate rounded bg-background px-2 py-1.5 text-xs">{fresh.token}</code>
            <Button size="sm" onClick={() => copy(fresh.token)}>Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Done</Button>
          </div>
        </div>
      )}
      {tokens.map((t) => (
        <Row key={t.id} label={t.name} hint={`Made ${fmtRelative(t.created_at)} · ${t.last_used_at ? `last used ${fmtRelative(t.last_used_at)}` : "not used yet"}`}>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(t.id, { onSuccess: () => toast("Token removed. The extension using it is signed out.") })}>
            Remove
          </Button>
        </Row>
      ))}
    </Section>
  );
}
