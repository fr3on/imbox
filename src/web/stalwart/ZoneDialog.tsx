import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Copy, Download, Loader2, Minus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import type { DnsCheckResult, StalwartDomain } from "@shared/types";
import { cn } from "@/lib/utils";
import { useStalwartMutations } from "@/api";
import { useCopy } from "@/lib/useCopy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorLine, errText } from "./parts";
import { fmtRelative } from "@/lib/format";
import { parseZoneFile, type ParsedDnsRecord } from "./zone";

function RecordTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    TXT: "border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10",
    MX: "border-indigo-500/30 text-indigo-700 dark:text-indigo-300 bg-indigo-500/10",
    TLSA: "border-cyan-500/30 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10",
    A: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
    AAAA: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
    CNAME: "border-sky-500/30 text-sky-700 dark:text-sky-300 bg-sky-500/10",
    SRV: "border-purple-500/30 text-purple-700 dark:text-purple-300 bg-purple-500/10",
  };

  return (
    <span
      className={cn(
        "font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border inline-block tracking-wide",
        styles[type] || "border-border text-foreground bg-muted"
      )}
    >
      {type}
    </span>
  );
}

function CopyCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        toast.success(`Copied: ${value.length > 28 ? value.slice(0, 28) + "…" : value}`);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => toast.error("Failed to copy"));
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      className="group flex items-center justify-between gap-1.5 w-full text-left font-mono text-xs py-1 px-1.5 rounded hover:bg-muted/80 transition-colors cursor-pointer"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 text-emerald-500 shrink-0" />
      ) : (
        <Copy className="size-3 text-muted-foreground/50 group-hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

const STATUS: Record<DnsCheckResult["status"], { label: string; tone: string; Icon: typeof Check }> = {
  ok: { label: "Live", tone: "text-emerald-600 dark:text-emerald-400", Icon: Check },
  missing: { label: "Missing", tone: "text-destructive", Icon: X },
  mismatch: { label: "Different", tone: "text-amber-600 dark:text-amber-400", Icon: CircleAlert },
  unknown: { label: "Could not check", tone: "text-muted-foreground", Icon: Minus },
  unchecked: { label: "Not checked", tone: "text-muted-foreground", Icon: Minus },
};

function StatusCell({ check, checking }: { check?: DnsCheckResult; checking: boolean }) {
  if (!check) return checking ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Checking" /> : null;
  const { label, tone, Icon } = STATUS[check.status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap", tone)} title={check.found.length ? `DNS has: ${check.found.join(" | ")}` : undefined}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function ZoneDialog({ serverId, domain, onClose }: { serverId: string; domain: StalwartDomain | null; onClose: () => void }) {
  const { zone, dnsCheck } = useStalwartMutations(serverId);
  const [checks, setChecks] = useState<Record<string, DnsCheckResult>>({});
  const [checkedAt, setCheckedAt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<string>("essential");
  const { copied, copy } = useCopy();

  useEffect(() => {
    if (!domain) return;
    let live = true;
    setText("");
    setErr("");
    setLoading(true);
    setTab("essential");
    setChecks({});
    setCheckedAt(0);
    setCheckErr("");
    zone(domain.id)
      .then((r) => live && setText(r.zone))
      .catch((e) => live && setErr(errText(e)))
      .finally(() => live && setLoading(false));
    runCheck(() => live);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain?.id]);

  /** Asks the server to look each record up in DNS. Takes a test for "still the same dialog" so a late answer for another domain is dropped. */
  const runCheck = (current: () => boolean = () => true) => {
    if (!domain) return;
    setChecking(true);
    setCheckErr("");
    dnsCheck(domain.id)
      .then((r) => {
        if (!current()) return;
        setChecks(Object.fromEntries(r.records.map((x) => [x.id, x])));
        setCheckedAt(r.checked_at);
      })
      .catch((e) => current() && setCheckErr(errText(e)))
      .finally(() => current() && setChecking(false));
  };

  const parsedRecords = useMemo(() => {
    return parseZoneFile(text, domain?.name);
  }, [text, domain?.name]);

  const essentialRecords = useMemo(() => {
    const list = parsedRecords.filter((r) => r.isEssential);
    return list.length > 0 ? list : parsedRecords;
  }, [parsedRecords]);

  const essentialChecks = essentialRecords.map((r) => checks[r.id]).filter((x): x is DnsCheckResult => !!x);
  const live = essentialChecks.filter((x) => x.status === "ok").length;

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${domain?.name ?? "domain"}.zone.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderTable = (records: ParsedDnsRecord[]) => (
    <div className="rounded-md border overflow-hidden">
      <div className="max-h-[50vh] overflow-y-auto">
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 text-xs">Type</TableHead>
              <TableHead className="w-48 text-xs">Host / Name</TableHead>
              <TableHead className="text-xs">Value</TableHead>
              <TableHead className="w-28 text-xs">Status</TableHead>
              <TableHead className="w-28 text-right text-xs">Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="py-1.5">
                  <RecordTypeBadge type={r.type} />
                </TableCell>
                <TableCell className="py-1.5">
                  <CopyCell value={r.shortName} />
                </TableCell>
                <TableCell className="py-1.5 max-w-md">
                  <CopyCell value={r.value} />
                  {checks[r.id] && checks[r.id].status === "mismatch" && (
                    <div className="px-1.5 pb-1 font-mono text-[11px] text-muted-foreground break-all">DNS has: {checks[r.id].found.join(" | ")}</div>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  <StatusCell check={checks[r.id]} checking={checking} />
                </TableCell>
                <TableCell className="py-1.5 text-right text-[11px] text-muted-foreground whitespace-nowrap">
                  {r.purpose}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <Dialog open={!!domain} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col p-6 gap-4">
        <DialogHeader className="pb-1">
          <DialogTitle>DNS records for {domain?.name}</DialogTitle>
          <DialogDescription>
            Publish these at your DNS host so mail can reach and leave this domain. On Cloudflare, keep mail records DNS-only (unproxied).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : err ? (
          <ErrorLine>{err}</ErrorLine>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between pb-2">
              <TabsList className="h-8">
                <TabsTrigger value="essential" className="text-xs px-3">
                  Essential Mail ({essentialRecords.length})
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs px-3">
                  All Records ({parsedRecords.length})
                </TabsTrigger>
                <TabsTrigger value="zone" className="text-xs px-3">
                  Zone File
                </TabsTrigger>
              </TabsList>
              {tab !== "zone" && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  Click any host or value to copy
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pb-2" aria-live="polite">
              <span className="text-xs text-muted-foreground">
                {checkErr
                  ? `DNS check failed: ${checkErr}`
                  : checking && !checkedAt
                    ? "Checking DNS..."
                    : checkedAt
                      ? `${live} of ${essentialChecks.length} essential records are live. Checked ${fmtRelative(checkedAt)}. DNS changes can take a while to show.`
                      : ""}
              </span>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={checking} onClick={() => runCheck()}>
                <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
                <span>{checking ? "Checking" : "Check DNS"}</span>
              </Button>
            </div>

            <TabsContent value="essential" className="mt-0">
              {renderTable(essentialRecords)}
            </TabsContent>

            <TabsContent value="all" className="mt-0">
              {renderTable(parsedRecords)}
            </TabsContent>

            <TabsContent value="zone" className="mt-0 space-y-2">
              <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted/50 p-3 text-[12px] leading-5 font-mono whitespace-pre-wrap break-all select-all">
                {text || "The server has no records for this domain yet."}
              </pre>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="pt-2 flex flex-col sm:flex-row sm:justify-between items-center gap-2 border-t">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!text}
              onClick={() => copy(text)}
              className="h-8 text-xs gap-1.5"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              <span>{copied ? "Zone Copied" : "Copy Zone File"}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!text}
              onClick={download}
              className="h-8 text-xs gap-1.5"
            >
              <Download className="size-3.5" />
              <span>Download .zone</span>
            </Button>
          </div>
          <Button type="button" onClick={onClose} size="sm" className="h-8 px-4 text-xs font-medium w-full sm:w-auto">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
