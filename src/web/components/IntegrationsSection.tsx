import { BrandIcon } from "./BrandIcons";
import { ExtensionSection } from "../settings/integrations/ExtensionSection";
import { Bot, Globe, Server, Brain } from "lucide-react";
import { useAiMemory, useAiSettings, useAutoAgents, useOAuthCredentials, useStalwartServers } from "../api";
import { SignInAppsSection } from "../settings/integrations/SignInApps";
import { Panel, Section, SectionsProvider } from "../settings/parts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function ServiceRow({ icon, name, status, detail, tone, onManage }: { icon: React.ReactNode; name: string; status: string; detail: string; tone: "on" | "off"; onManage: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:px-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          <Badge variant={tone === "on" ? "secondary" : "outline"} className={cn(tone === "off" && "text-muted-foreground")}>{status}</Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground" onClick={onManage}>Manage</Button>
    </div>
  );
}

/** Everything Imbox connects to besides mailboxes: the Google and Microsoft apps it signs in through, and where the other services are set up. */
export function IntegrationsSection({ onGoToTab }: { onGoToTab: (tab: string) => void }) {
  const creds = useOAuthCredentials();
  const ai = useAiSettings();
  const servers = useStalwartServers();
  const agents = useAutoAgents();
  const byProvider = new Map((creds.data ?? []).map((c) => [c.provider, c]));
  const serverCount = servers.data?.length ?? 0;
  const activeAgents = (agents.data ?? []).filter((a) => a.enabled).length;
  const memoryCount = useAiMemory().data?.length;
  const learning = ai.data?.learn !== false;
  const memoryDetail = [
    memoryCount === undefined ? "" : memoryCount === 0 ? "Nothing remembered yet" : `${memoryCount} ${memoryCount === 1 ? "thing" : "things"} remembered`,
    learning ? "learns from your mail" : "learning is off",
  ]
    .filter(Boolean)
    .join(" · ");
  const manageMemory = () => onGoToTab("ai");

  const active = [!!ai.data?.configured, serverCount > 0, activeAgents > 0, !!byProvider.get("google")?.configured].filter(Boolean).length;

  return (
    <SectionsProvider>
      <SignInAppsSection />

      <Section title="Connected services" collapsible summary={`${active} of 4 active`} description="Where the rest of imbox reaches out to, and how to change it.">
        <Panel>
          <ServiceRow
            icon={<BrandIcon name="assistant" />}
            name="AI provider"
            status={ai.data?.configured ? "Connected" : "Not set up"}
            tone={ai.data?.configured ? "on" : "off"}
            detail={ai.data?.configured ? `${ai.data.preset} · ${ai.data.model}` : "Powers the assistant, replies, summaries and Screener suggestions."}
            onManage={() => onGoToTab("ai")}
          />
          <ServiceRow
            icon={<Brain />}
            name="Memory"
            status="Built in"
            tone="on"
            detail={memoryDetail}
            onManage={manageMemory}
          />
          <ServiceRow
            icon={<Server />}
            name="Mail servers"
            status={serverCount ? `${serverCount} connected` : "None"}
            tone={serverCount ? "on" : "off"}
            detail={serverCount ? "Stalwart servers Imbox creates domains and mailboxes on." : "Connect a Stalwart server to create mailboxes on your own domain."}
            onManage={() => onGoToTab("servers")}
          />
          <ServiceRow
            icon={<Bot />}
            name="Agents"
            status={activeAgents ? `${activeAgents} running` : "None running"}
            tone={activeAgents ? "on" : "off"}
            detail="Agents that handle mail for you, and API keys for outside agents."
            onManage={() => onGoToTab("agents")}
          />
          <ServiceRow
            icon={<BrandIcon name="calendar" />}
            name="Calendars"
            status={byProvider.get("google")?.configured ? "Google ready" : "Updates only"}
            tone={byProvider.get("google")?.configured ? "on" : "off"}
            detail="Subscribed calendar feeds work without setup. Google Calendar needs the Google sign-in app above."
            onManage={() => onGoToTab("calendar")}
          />
          <ServiceRow
            icon={<Globe />}
            name="Domains"
            status="Email Routing"
            tone="off"
            detail="Your own domains and how their mail reaches Imbox."
            onManage={() => onGoToTab("domains")}
          />
        </Panel>
      </Section>

      <ExtensionSection />
    </SectionsProvider>
  );
}
