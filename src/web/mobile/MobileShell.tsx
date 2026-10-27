import { BrandIcon } from "../components/BrandIcons";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, Layers, Loader2, Plus, } from "lucide-react";
import { Mark } from "../components/Logo";
import { ALL, useAccount } from "../context/AccountContext";
import { startGoogleConnect, startMicrosoftConnect } from "../lib/connect";
import { ActionSheet } from "./ActionSheet";
import { SyncSummary, healthOf, syncText } from "../components/SyncPill";
import { needsAttention } from "../lib/accountGroups";
import { useNavigate } from "react-router-dom";

/** Mobile layout: only the auth guard; each screen draws its own bars. */
export function MobileShell() {
  const { user, loading, error, appName, brandReady } = useAccount();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Mark /> <span className={brandReady ? undefined : "invisible"}>{appName}</span>
      </div>
    );
  }
  if (error || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <Outlet />
  );
}

/** Account scope picker as a bottom sheet (tap the Imbox title). */
export function ScopeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accounts, scope, setScope, glyphFor, googleConfigured, microsoftConfigured } = useAccount();
  const nav = useNavigate();
  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Imbox scope"
      top={<SyncSummary large className="mx-4 mb-2" />}
      actions={[
        { icon: <Layers />, label: "All accounts", hint: accounts.length > 1 ? accounts.length : undefined, checked: scope === ALL, onSelect: () => { setScope(ALL); nav("/"); } },
        ...accounts.map((a) => ({
          icon: <span className="text-[13px] w-5 text-center">{glyphFor(a.id)}</span>,
          label: a.email,
          sub: syncText(a),
          warn: needsAttention(a),
          hint: needsAttention(a) ? <AlertTriangle size={15} className="text-amber-600 dark:text-amber-500" /> : healthOf(a) === "syncing" ? <Loader2 size={15} className="animate-spin" /> : undefined,
          checked: scope === a.id,
          onSelect: () => { setScope(a.id); nav("/"); },
        })),
...(googleConfigured ? [{ icon: <Plus />, label: "Connect Gmail", onSelect: () => startGoogleConnect() }] : []),
        ...(microsoftConfigured ? [{ icon: <Plus />, label: "Connect Outlook", onSelect: () => startMicrosoftConnect() }] : []),
        { icon: <BrandIcon name="settings" />, label: "Manage accounts", onSelect: () => nav("/settings/accounts") },
      ]}
    />
  );
}

export function useScopeLabel(): string {
  const { accounts, scope, account } = useAccount();
  if (accounts.length === 0) return "";
  if (scope === ALL) return accounts.length > 1 ? "All accounts" : accounts[0].email;
  return account?.email ?? "All accounts";
}
