import { cn } from "@/lib/utils";
import { Paperclip, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { DraftCard } from "./DraftCard";
import { EventProposalCard } from "./EventProposalCard";
import { WorkflowProposalCard } from "./WorkflowProposalCard";
import type { Turn } from "./turns";
import { Prose } from "./prose";
import { ThinkingDots } from "./prose";
import { ToolLine } from "./prose";
import { BulkActionCard } from "./BulkActionCard";

export function Transcript({ all, live, page, bottomRef }: { all: Turn[]; live: Turn | null; page: boolean; bottomRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className={cn(page && "w-full")}>
     <div className="py-4 space-y-5">
       {all.map((t) => (
         <div key={t.id} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
           {t.role === "user" ? (
             <div className="max-w-[85%]">
               {!!t.context?.length && (
                 <div className="flex flex-wrap justify-end gap-1 mb-1">
                   {t.context.map((c) => (
                     <Link key={c.id} to={`/t/${c.id}`} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 h-6 text-[12px] text-muted-foreground max-w-[220px]">
                       <Paperclip className="size-3 shrink-0" />
                       <span className="truncate">{c.subject || "(no subject)"}</span>
                     </Link>
                   ))}
                 </div>
               )}
               <div className="rounded-2xl rounded-br-xs bg-foreground text-background px-4 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap shadow-xs">{t.text}</div>
             </div>
           ) : (
             <div className="max-w-[92%] min-w-0">
               {t.tools.length > 0 && <div className="mb-1">{t.tools.map((x) => <ToolLine key={x.id} status={x.status} summary={x.summary} />)}</div>}
               {t.text ? <Prose text={t.text} /> : t === live && !t.error ? <ThinkingDots /> : null}
               {t.drafts.map((d) => <DraftCard key={d.draft_id} d={d} sentThreadId={t.sent[d.draft_id]} />)}
               {t.eventProposals?.map((p) => <EventProposalCard key={p.id} p={p} />)}
               {t.workflowProposals?.map((p) => <WorkflowProposalCard key={p.id} p={p} />)}
               {t.bulkActionProposals?.map((p) => <BulkActionCard key={p.id} p={p} />)}
               {t.error && <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-[13px]"><TriangleAlert className="size-4 shrink-0 mt-0.5 text-muted-foreground" /><span>{t.error}{/API key/i.test(t.error) && <> · <Link to="/settings/ai" className="underline underline-offset-2">Settings → AI</Link></>}</span></div>}
             </div>
           )}
         </div>
       ))}
       <div ref={bottomRef} />
     </div>
    </div>
  );
}
