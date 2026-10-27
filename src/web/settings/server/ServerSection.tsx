import { CircleCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { useSystemInfo } from "@/api";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtRelative, fmtSize } from "@/lib/format";
import { pct, serverHealth } from "@/lib/serverHealth";
import { Panel, Row, Section } from "../parts";

/** 3 days 4 hours, 5 hours 12 minutes, 8 minutes. */
function span(s: number): string {
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d) return `${d} day${d === 1 ? "" : "s"} ${h} hour${h === 1 ? "" : "s"}`;
  if (h) return `${h} hour${h === 1 ? "" : "s"} ${m} minute${m === 1 ? "" : "s"}`;
  return `${Math.max(m, 1)} minute${m === 1 ? "" : "s"}`;
}

/** A figure with a bar under it. */
function Meter({ label, hint, value, detail }: { label: string; hint?: string; value: number; detail: string }) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex w-56 flex-col items-end gap-1.5">
        <span className="text-sm tnum">{detail}</span>
        <Progress value={value} aria-label={`${label} in use`} className="h-1.5" />
      </div>
    </Row>
  );
}

const Value = ({ children }: { children: React.ReactNode }) => <span className="text-sm tnum break-words">{children}</span>;

export function ServerSection() {
  const { data: s, isLoading, isError, error, refetch, isFetching } = useSystemInfo();

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !s) return <p className="px-2 text-sm text-muted-foreground">Could not read the server. {(error as Error | null)?.message ?? ""}</p>;

  const h = s.host;
  const health = serverHealth(s);
  const mem = pct(h.memory_used, h.memory_total);
  const disk = h.disk_total ? pct(h.disk_used ?? 0, h.disk_total) : 0;
  const biggest = s.database.tables[0]?.bytes || 1;
  const Icon = health.ok ? CircleCheck : TriangleAlert;

  return (
    <>
      <div className={cn("mb-4 flex items-start gap-3 rounded-xl border px-4 py-3", health.ok ? "border-border/80 bg-muted/40" : "border-foreground/60 bg-muted/60")} role="status">
        <Icon size={20} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{health.ok ? "Healthy" : "Needs attention"}</div>
          <div className="text-[13px] text-muted-foreground">{health.line}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Read {fmtRelative(s.checked_at)}. Refreshes every few seconds while this page is open.</div>
        </div>
        <Button type="button" size="sm" variant="ghost" className="shrink-0 text-muted-foreground" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCw className={cn(isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <Section title="Usage" collapsible defaultOpen={!health.ok} summary={`Processor ${h.cpu_percent}% · memory ${fmtSize(h.memory_used)} of ${fmtSize(h.memory_total)}`}>
        <Panel>
          <Meter label="Processor" hint={`Load ${h.load.join(", ")} over 1, 5 and 15 minutes`} value={h.cpu_percent} detail={`${h.cpu_percent}% of ${h.cpu_cores} core${h.cpu_cores === 1 ? "" : "s"}`} />
          <Meter label="Memory" hint={h.memory_limited ? "The limit set for this container" : undefined} value={mem} detail={`${fmtSize(h.memory_used)} of ${fmtSize(h.memory_total)}`} />
          {h.disk_total != null && <Meter label="Disk" hint="Where Imbox keeps its files" value={disk} detail={`${fmtSize(h.disk_used ?? 0)} of ${fmtSize(h.disk_total)}`} />}
          <Row label="Imbox process" hint="What this app alone is using">
            <Value>{fmtSize(h.process.rss)} memory</Value>
          </Row>
        </Panel>
      </Section>

      <Section title="Specs" collapsible summary={`${h.os.split(" ")[0]} · ${h.cpu_cores} core${h.cpu_cores === 1 ? "" : "s"} · ${fmtSize(h.memory_total)}`}>
        <Panel>
          <Row label="System"><Value>{h.os} ({h.arch})</Value></Row>
          <Row label="Processor"><Value>{h.cpu_model}</Value></Row>
          <Row label="Cores"><Value>{h.cpu_cores}</Value></Row>
          <Row label="Memory" hint={h.memory_limited ? "Limited by the container" : undefined}><Value>{fmtSize(h.memory_total)}</Value></Row>
          {h.disk_total != null && <Row label="Disk"><Value>{fmtSize(h.disk_total)}</Value></Row>}
          <Row label="Host name"><Value>{h.hostname}</Value></Row>
          <Row label="Machine up for"><Value>{span(h.host_uptime_s)}</Value></Row>
        </Panel>
      </Section>

      <Section title="Imbox" collapsible summary={`${s.app.version} · up ${span(h.process.uptime_s)}`}>
        <Panel>
          <Row label="Version"><Value>{s.app.version}</Value></Row>
          <Row label="Build" hint={`Built ${fmtRelative(new Date(s.app.built_at).getTime())}`}><Value>{s.app.commit}</Value></Row>
          <Row label="Running for"><Value>{span(h.process.uptime_s)}</Value></Row>
          <Row label="Node"><Value>{h.node}</Value></Row>
        </Panel>
      </Section>

      <Section title="Database" collapsible description="The tables that take the most room." summary={`PostgreSQL ${s.database.version} · ${fmtSize(s.database.bytes)}`}>
        <Panel>
          <Row label="PostgreSQL"><Value>{s.database.version}</Value></Row>
          <Row label="Size on disk"><Value>{fmtSize(s.database.bytes)}</Value></Row>
          {s.database.tables.map((t) => (
            <Row key={t.name} label={t.name} hint={`${t.rows.toLocaleString()} row${t.rows === 1 ? "" : "s"}`}>
              <div className="flex w-56 flex-col items-end gap-1.5">
                <span className="text-sm tnum">{fmtSize(t.bytes)}</span>
                <Progress value={pct(t.bytes, biggest)} aria-hidden className="h-1" />
              </div>
            </Row>
          ))}
        </Panel>
      </Section>
    </>
  );
}
