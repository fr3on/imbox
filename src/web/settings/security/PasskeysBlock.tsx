import { BrandIcon } from "@/components/BrandIcons";
import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePasskeys, usePasskeyMutations } from "@/api";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Row, Section } from "../parts";

export function PasskeysBlock() {
  const { data, isLoading } = usePasskeys();
  const { register, rename, remove } = usePasskeyMutations();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const passkeys = data?.passkeys ?? [];

  const handleAddPasskey = async () => {
    setCreating(true);
    try {
      const ua = navigator.userAgent;
      let defaultName = "Passkey";
      if (/Macintosh/i.test(ua)) defaultName = "Mac Touch ID / Passkey";
      else if (/iPhone|iPad/i.test(ua)) defaultName = "iCloud Keychain";
      else if (/Android/i.test(ua)) defaultName = "Android Passkey";
      else if (/Windows/i.test(ua)) defaultName = "Windows Hello";

      await register.mutateAsync(defaultName);
      toast.success("Passkey registered successfully");
    } catch (err: any) {
      if (err.name === "NotAllowedError") return;
      toast.error(err.message || "Failed to create passkey");
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await rename.mutateAsync({ id, name: editName.trim() });
      setEditingId(null);
      toast.success("Passkey renamed");
    } catch (err: any) {
      toast.error(err.message || "Failed to rename passkey");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast.success("Passkey removed");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete passkey");
    }
  };

  return (
    <Section
      title="Passkeys"
      collapsible
      defaultOpen
      summary={isLoading ? "…" : passkeys.length ? `${passkeys.length} registered` : "None yet"}
      description="Sign in with Touch ID, Face ID, Windows Hello or a security key, with no password to type."
      actions={
        <Button type="button" size="sm" onClick={handleAddPasskey} disabled={creating} className="gap-1.5 shrink-0">
          {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add a passkey
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground sm:px-5">
          <Loader2 size={14} className="animate-spin" /> Loading passkeys…
        </div>
      ) : passkeys.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted-foreground sm:px-5">None yet. Add one to sign in with your fingerprint, face or a security key.</p>
      ) : (
        passkeys.map((p) => (
          <Row
            key={p.id}
            label={
              editingId === p.id ? (
                <span className="flex items-center gap-1.5">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 w-48 text-xs"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(p.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button size="xs" onClick={() => handleRename(p.id)}>Save</Button>
                  <Button size="xs" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="truncate">{p.name}</span>
                  <button type="button" onClick={() => { setEditingId(p.id); setEditName(p.name); }} className="text-[11px] font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    Rename
                  </button>
                </span>
              )
            }
            hint={`Added ${fmtDate(p.created_at)}${p.last_used_at ? ` · Last used ${fmtRelative(p.last_used_at)}` : ""}`}
          >
            <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(p.id)} title="Remove passkey" aria-label={`Remove ${p.name}`}>
              <BrandIcon name="trash" size={13} />
            </Button>
          </Row>
        ))
      )}
    </Section>
  );
}

/* ---------- Page ---------- */
