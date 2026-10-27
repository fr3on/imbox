
import { type Dispatch, type SetStateAction } from "react";
import { RefreshCw, } from "lucide-react";
import { toast } from "sonner";
import type { AiSettings } from "@shared/types";
import { useAiMutations, } from "../../api";
import { Section, Row, Panel, } from "../../settings/parts";
import { Button } from "@/components/ui/button";
import { fmtRelative } from "../../lib/format";
import { cn } from "@/lib/utils";

/** What the assistant remembers, in one line with Review and Learn now. */
export function MemoryOverview({ memories, s, showMemory, setShowMemory, m }: {
  memories: number;
  s: AiSettings | undefined;
  showMemory: boolean;
  setShowMemory: Dispatch<SetStateAction<boolean>>;
  m: ReturnType<typeof useAiMutations>;
}) {
  return (
    <Section title="Memory" collapsible defaultOpen summary={memories === 0 ? "Nothing yet" : `${memories} remembered`} description="What the assistant remembers about you, used to write in your voice and follow your habits.">
      <Panel>
        <Row label={memories === 0 ? "Nothing remembered yet" : `${memories} ${memories === 1 ? "thing" : "things"} remembered`} hint={s?.last_learned_at ? `Last learned ${fmtRelative(s.last_learned_at)}` : "It learns as you send mail."}>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setShowMemory((v) => !v)} aria-expanded={showMemory}>
              {showMemory ? "Hide" : "Review"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                m.learn.mutate(undefined, {
                  onSuccess: (r) => toast(r.skipped === "nothing_new" ? "Nothing new to learn from" : r.skipped === "no_key" ? "Add an API key first" : `Learned · ${r.changed} update${r.changed === 1 ? "" : "s"}`),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
              disabled={m.learn.isPending}
            >
              <RefreshCw className={cn(m.learn.isPending && "animate-spin")} /> Learn now
            </Button>
          </div>
        </Row>
      </Panel>
    </Section>
  );
}
