import { useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import type { StalwartDomain } from "@shared/types";
import { useStalwartMutations } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorLine, errText } from "./parts";

export function AddDomainForm({ serverId, onAdded, onCancel }: { serverId: string; onAdded: (d: StalwartDomain) => void; onCancel?: () => void }) {
  const { createDomain } = useStalwartMutations(serverId);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const ready = /\./.test(name.trim());
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || createDomain.isPending) return;
        setErr("");
        createDomain.mutate(name.trim().toLowerCase(), { onSuccess: (d) => { setName(""); onAdded(d); }, onError: (e2) => setErr(errText(e2)) });
      }}
    >
      <Field>
        <FieldLabel htmlFor="dm-name">Domain</FieldLabel>
        <Input id="dm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <FieldDescription>You'll get the DNS records to publish right after.</FieldDescription>
      </Field>
      {err ? <ErrorLine>{err}</ErrorLine> : null}
      <div className="flex items-center justify-end gap-2">
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" disabled={!ready || createDomain.isPending}>
          {createDomain.isPending ? <Loader2 className="animate-spin" /> : <Globe />} Add domain
        </Button>
      </div>
    </form>
  );
}
