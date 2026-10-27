import { BrandIcon } from "@/components/BrandIcons";
import { useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import { toast } from "sonner";
import type { StalwartDomain, StalwartServer } from "@shared/types";
import { cn } from "@/lib/utils";
import { useStalwartDomains, useStalwartMailboxes, useStalwartMutations } from "@/api";
import { domainCounts } from "@/lib/mailboxFilter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MailboxesBlock } from "./MailboxesBlock";
import { ZoneDialog } from "./ZoneDialog";
import { ErrorLine, errText } from "./parts";

/**
 * The domains on one Stalwart server as rows for the Domains page: the name, where it lives, whether it is on, how many mailboxes, DNS records, and a
 * row that opens to that domain's mailboxes.
 */
export function StalwartDomainRows({ server }: { server: StalwartServer }) {
  const domains = useStalwartDomains(server.id);
  const boxes = useStalwartMailboxes(server.id);
  const { setDomainEnabled, deleteDomain } = useStalwartMutations(server.id);
  const [zoneFor, setZoneFor] = useState<StalwartDomain | null>(null);
  const [del, setDel] = useState<StalwartDomain | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const counts = new Map(domainCounts(boxes.data ?? []).map((c) => [c.domain, c.count]));

  if (domains.isLoading) return <div className="p-3"><Skeleton className="h-8 w-full" /></div>;
  if (domains.isError) return <div className="p-3"><ErrorLine>{errText(domains.error)}</ErrorLine></div>;
  return (
    <>
      {(domains.data ?? []).map((d) => {
        const n = counts.get(d.name) ?? 0;
        return (
          <Collapsible key={d.id} open={open === d.id} onOpenChange={(o) => setOpen(o ? d.id : null)} className="border-b border-border last:border-b-0">
            <div className="flex min-h-12 flex-col gap-2 px-2 py-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Globe size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{d.name}</span>
                    <Badge variant="outline" className="font-normal text-muted-foreground">Stalwart</Badge>
                    <Badge variant={d.isEnabled ? "secondary" : "outline"} className="font-normal">{d.isEnabled ? "Enabled" : "Disabled"}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground tnum">
                    {n} mailbox{n === 1 ? "" : "es"} · on {server.name}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 pl-7 sm:pl-0">
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setZoneFor(d)}>DNS records</Button>
                <Switch aria-label={`${d.name} enabled`} checked={d.isEnabled} disabled={setDomainEnabled.isPending} onCheckedChange={(v) => setDomainEnabled.mutate({ id: d.id, is_enabled: v }, { onError: (e) => toast.error(errText(e)) })} />
                <Button size="icon-xs" variant="ghost" aria-label={`Delete ${d.name}`} className="text-muted-foreground" onClick={() => setDel(d)}><BrandIcon name="trash" /></Button>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-muted-foreground">
                    Details <ChevronDown className={cn("transition-transform duration-100", open === d.id && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
            <CollapsibleContent>
              <div className="pb-5 pl-9 pr-2">
                <MailboxesBlock server={server} domain={d.name} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      <ZoneDialog serverId={server.id} domain={zoneFor} onClose={() => setZoneFor(null)} />
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {del?.name}?</AlertDialogTitle>
            <AlertDialogDescription>The server refuses this while the domain still has mailboxes. Delete or move those first.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del && deleteDomain.mutate(del.id, { onSuccess: () => toast(`${del.name} deleted`), onError: (e) => toast.error(errText(e), { duration: 10000 }) })}>Delete domain</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
