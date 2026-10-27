import { useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useOAuthCredentials, type OAuthCredentialStatus } from "@/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel, Section } from "../parts";
import { CredentialsForm } from "../accounts/ConnectorCredentials";

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5">
      <code className="min-w-0 flex-1 truncate text-[12.5px]">{value}</code>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="shrink-0 text-muted-foreground"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast("Copied"), () => toast.error("Couldn't copy"))}
      >
        <Copy /> Copy
      </Button>
    </div>
  );
}

interface ProviderGuide {
  id: "google" | "microsoft";
  name: string;
  enables: string[];
  consoleUrl: string;
  consoleLabel: string;
  redirectPath: string;
  steps: string[];
  scopes: string;
}

const GUIDES: ProviderGuide[] = [
  {
    id: "google",
    name: "Google",
    enables: ["Gmail mailboxes", "Google Calendar (with meeting links)", "Contacts"],
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    consoleLabel: "Google Cloud Console",
    redirectPath: "/auth/google/callback",
    steps: [
      "Create an OAuth client of type Web application.",
      "Enable the Gmail, Google Calendar and People APIs for the project.",
      "Add the redirect address below to the client.",
      "Paste the client ID and secret below.",
    ],
    scopes: "Gmail (modify), Calendar, Contacts, and your basic profile. A calendar-only connection asks for no mail access.",
  },
  {
    id: "microsoft",
    name: "Microsoft",
    enables: ["Outlook.com and Microsoft 365 mailboxes"],
    consoleUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    consoleLabel: "Microsoft Entra admin center",
    redirectPath: "/auth/microsoft/callback",
    steps: [
      "Register an app that accepts any organisation and personal Microsoft accounts.",
      "Add the redirect address below as a Web platform redirect URI.",
      "Under API permissions add Mail.ReadWrite, Mail.Send, User.Read and offline_access.",
      "Create a client secret and paste it, with the application ID, below.",
    ],
    scopes: "Mail.ReadWrite, Mail.Send, User.Read, offline_access.",
  },
];

/** One provider's whole setup: what it connects, the steps, the redirect address and the credentials. Open while it is not set up, folded once it is. */
function AppCard({ g, c, compact }: { g: ProviderGuide; c: OAuthCredentialStatus | undefined; compact?: boolean }) {
  const configured = !!c?.configured;
  const [open, setOpen] = useState(!configured);
  const redirect = `${window.location.origin}${g.redirectPath}`;
  const tail = c?.client_id ? c.client_id.slice(-4) : "";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border/60 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <h3 className="text-sm font-semibold">{g.name}</h3>
            {configured ? <Badge variant="secondary" className="gap-1"><Check className="size-3" /> Set up</Badge> : <Badge variant="outline">Not set up</Badge>}
            {configured && c?.source === "env" && <Badge variant="outline">Environment variable</Badge>}
            {c?.overriding && <Badge variant="outline">Overriding environment variable</Badge>}
            <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <span className="flex-1" />
        {configured && !open && tail && <span className="text-xs text-muted-foreground tnum">Client ID ends …{tail}</span>}
        <Button asChild size="xs" variant="ghost" className="text-muted-foreground">
          <a href={g.consoleUrl} target="_blank" rel="noreferrer">{g.consoleLabel} <ExternalLink /></a>
        </Button>
      </div>
      <CollapsibleContent>
        <div className="space-y-4 px-4 pb-5 sm:px-5">
          <p className="text-[13px] text-muted-foreground">Connects: {g.enables.join(", ")}.</p>
          {!configured && (
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground marker:text-tertiary">
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Redirect address</div>
            <CopyLine value={redirect} />
          </div>
          {c && <CredentialsForm c={c} compact={compact} />}
          <p className="text-xs text-tertiary">Asks for: {g.scopes}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The Google and Microsoft apps Imbox signs in with: the steps to make each one and where its credentials go, together. */
export function SignInAppsSection({ compact }: { compact?: boolean }) {
  const { data, isLoading } = useOAuthCredentials();
  const byProvider = new Map((data ?? []).map((c) => [c.provider, c]));
  return (
    <Section title="Sign-in apps" collapsible defaultOpen summary={isLoading ? "…" : `${GUIDES.filter((g) => byProvider.get(g.id)?.configured).length} of ${GUIDES.length} set up`} description="The Google and Microsoft apps you own. Set one up once and every mailbox on that provider can use it. Rotate a secret here without redeploying.">
      {isLoading ? (
        <div className="px-4 py-3 sm:px-5"><Skeleton className="h-16 w-full" /></div>
      ) : (
        <Panel>
          {GUIDES.map((g) => (
            <AppCard key={g.id} g={g} c={byProvider.get(g.id)} compact={compact} />
          ))}
        </Panel>
      )}
    </Section>
  );
}
