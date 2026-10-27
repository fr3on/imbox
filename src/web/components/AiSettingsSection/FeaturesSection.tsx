
import { Link } from "react-router-dom";
import type { AiSettings } from "@shared/types";
import { useAiMutations, useAiUsage } from "../../api";
import { fmtTokens } from "../../lib/aiUsage";
import { Section, Panel, SavedMark } from "../../settings/parts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FeatureRow } from "./FeatureRow";

/** The AI features, each with its switch (or a link to where it is set) and a bar for its use in the last 30 days. */
export function FeaturesSection({ s, tok, top, flip, savedMark, usage, onRequest }: {
  s: AiSettings | undefined;
  tok: (k: string) => number | undefined;
  top: number;
  flip: (patch: Parameters<ReturnType<typeof useAiMutations>["saveSettings"]["mutate"]>[0]) => void;
  savedMark: boolean;
  usage: ReturnType<typeof useAiUsage>;
  onRequest: number;
}) {
  return (
    <Section title="What the AI does" collapsible defaultOpen summary={`${[s?.screener_suggest !== false, s?.daily_brief !== false, s?.suggest_actions !== false, !!s?.learn].filter(Boolean).length} of 4 on`} description="Switches save as you flip them. The bars show use in the last 30 days." actions={<SavedMark show={savedMark} />}>
      <Panel>
        <FeatureRow label="Suggest where new senders go" hint="Reads each waiting sender and suggests a place, with a reason. Nothing moves until you decide." tokens={tok("screener")} top={top}>
          <Switch checked={s?.screener_suggest !== false} onCheckedChange={(v) => flip({ screener_suggest: v })} aria-label="Suggest where new senders go" />
        </FeatureRow>
        <FeatureRow label="Pick my daily brief with AI" hint="Also writes the digest at the top of Feed. Off: the brief is sorted by plain rules, there is no digest, and nothing is sent to your provider." tokens={tok("brief")} top={top}>
          <Switch checked={s?.daily_brief !== false} onCheckedChange={(v) => flip({ daily_brief: v })} aria-label="Pick my daily brief with AI" />
        </FeatureRow>
        <FeatureRow label="Suggest events and to-dos from mail" hint="Offers to add a proposed meeting or a deadline to the calendar. Nothing is added until you say so." tokens={tok("actions")} top={top}>
          <Switch checked={s?.suggest_actions !== false} onCheckedChange={(v) => flip({ suggest_actions: v })} aria-label="Suggest events and to-dos from mail" />
        </FeatureRow>
        <FeatureRow label="Learn from my mail" hint="Learns your tone, sign-offs and recurring facts from what you send. At most twice a day." tokens={tok("learn")} top={top}>
          <Switch checked={!!s?.learn} onCheckedChange={(v) => flip({ learn: v })} aria-label="Learn from my mail" />
        </FeatureRow>
        <FeatureRow label="One-line summaries on cards" hint="The short summary on each Imbox card. Used whenever an AI provider is set up." tokens={tok("gist")} top={top}>
          <span className="text-xs text-muted-foreground">Always on</span>
        </FeatureRow>
        <FeatureRow label="Offer to move mail to the Imbox" hint="A thread in Feed that needs you. The switch is in Preferences, under Mail." tokens={tok("rescue")} top={top}>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/preferences">Open</Link>
          </Button>
        </FeatureRow>
        <FeatureRow label="Mail agents" hint="Background workers that draft or send replies by your rules. Set up under Agents." tokens={tok("agents")} top={top}>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/agents">Manage</Link>
          </Button>
        </FeatureRow>
        <FeatureRow warn label="Send mail without asking" hint="Off: the assistant only prepares drafts and you press Send. On: it may send on its own when you clearly ask it to." top={top}>
          <Switch checked={!!s?.auto_send} onCheckedChange={(v) => flip({ auto_send: v })} aria-label="Send mail without asking" />
        </FeatureRow>
      </Panel>
      {usage.data && onRequest > 0 && (
        <p className="mx-4 my-3 sm:mx-5 text-xs text-muted-foreground">
          Chat, reply drafts and summaries you ask for used {fmtTokens(onRequest)} tokens. <Link to="/ai-usage" className="underline underline-offset-2 hover:text-foreground">See all usage</Link>
        </p>
      )}
    </Section>
  );
}
