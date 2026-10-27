
import { Link } from "react-router-dom";
import { ExternalLink, ListChecks, Loader2, Pencil, } from "lucide-react";
import type { AiSettings } from "@shared/types";
import { useAiMutations, useAiUsage } from "../../api";
import { fmtTokens } from "../../lib/aiUsage";
import { Button } from "@/components/ui/button";

/** The working connection as one line: the model, where it runs, the use over 30 days, and Test, Edit and Usage. */
export function ConnectionSummary({ s, presetLabel, host, usage, total, runTest, setEditing, m }: {
  s: AiSettings;
  presetLabel: string;
  host: string;
  usage: ReturnType<typeof useAiUsage>;
  total: number;
  runTest: () => void;
  setEditing: (editing: boolean) => void;
  m: ReturnType<typeof useAiMutations>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
      <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <div className="min-w-[12rem] flex-1">
        <div className="truncate font-mono text-sm font-medium">{s.model}</div>
        <div className="truncate text-xs text-muted-foreground">
          {presetLabel}
          {s.presets.find((x) => x.id === s.preset)?.editable_url && host ? ` · ${host}` : ""}
          {s.key_hint ? " · key stored" : ""}
        </div>
      </div>
      {usage.data && <span className="text-xs text-muted-foreground tnum">{fmtTokens(total)} tokens in 30 days</span>}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={runTest} disabled={m.check.isPending}>
          {m.check.isPending ? <Loader2 className="animate-spin" /> : <ListChecks />} Test
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil /> Edit
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/ai-usage">
            Usage <ExternalLink className="text-muted-foreground" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
