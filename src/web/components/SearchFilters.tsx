import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isoDay, parseSearch, withFilter, withoutFilter } from "@shared/searchQuery";
import { Check, ChevronDown, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import type { SearchFacets } from "../api";
import { bucketName } from "./BulkBar";

// The filter buttons under the search box. Each one reads the query, shows what it is set to, and writes its change back into the query text,
// so the box, the chips and the buttons are always the same thing said three ways.

const DAY = 86_400_000;

const day = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }));

function Pill({ active, children, className, ...rest }: { active?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
        active ? "border-foreground/40 bg-accent font-medium text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function Menu({ label, active, children, width = "w-64" }: { label: ReactNode; active: boolean; children: ReactNode; width?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pill active={active}>
          <span className="max-w-[12rem] truncate">{label}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Pill>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={width}>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ on, onSelect, children, count }: { on?: boolean; onSelect: () => void; children: ReactNode; count?: number }) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <span className="grid size-4 shrink-0 place-items-center">{on && <Check className="size-3.5" />}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="tnum text-xs text-muted-foreground">{count}</span>}
    </DropdownMenuItem>
  );
}

export function SearchFilterBar({ q, facets, onChange, now = Date.now(), trailing }: { q: string; facets?: SearchFacets | null; onChange: (next: string) => void; now?: number; trailing?: ReactNode }) {
  const { parsed } = parseSearch(q, now);
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const set = (key: string, value: string | null) => onChange(withFilter(q, key, value));
  const setRange = (after: number | null, before: number | null) => {
    const base = withoutFilter(q, "after", "before");
    onChange([base, after !== null ? `after:${isoDay(after)}` : "", before !== null ? `before:${isoDay(before)}` : ""].filter(Boolean).join(" "));
  };
  const hasRange = parsed.after !== null || parsed.before !== null;
  const rangeLabel = !hasRange ? "Any time" : parsed.after !== null && parsed.before !== null ? `${day(parsed.after)} – ${day(parsed.before - DAY)}` : parsed.after !== null ? `Since ${day(parsed.after)}` : `Before ${day(parsed.before)}`;
  const presets: { label: string; after: number }[] = [
    { label: "Past week", after: today - 7 * DAY },
    { label: "Past month", after: today - 30 * DAY },
    { label: "Past 3 months", after: today - 90 * DAY },
    { label: "Past year", after: today - 365 * DAY },
  ];
  const places = (facets?.places ?? []).filter((p) => p.bucket !== "trash");
  const mailboxes = facets?.mailboxes ?? [];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Narrow the results">
      <Menu label={parsed.from ? `From: ${parsed.from}` : "From"} active={!!parsed.from} width="w-80">
        {(facets?.senders ?? []).length === 0 && !parsed.from && <div className="px-2 py-1.5 text-xs text-muted-foreground">Search first, and the senders found show here.</div>}
        {(facets?.senders ?? []).map((s) => (
          <Row key={s.email} on={parsed.from.toLowerCase() === s.email.toLowerCase()} count={s.count} onSelect={() => set("from", s.email)}>
            {s.name ? `${s.name} ` : ""}
            <span className="text-muted-foreground">{s.name ? `<${s.email}>` : s.email}</span>
          </Row>
        ))}
        {parsed.from && (
          <>
            <DropdownMenuSeparator />
            <Row onSelect={() => set("from", null)}>Any sender</Row>
          </>
        )}
      </Menu>

      <Menu label={rangeLabel} active={hasRange}>
        <Row on={!hasRange} onSelect={() => setRange(null, null)}>Any time</Row>
        {presets.map((p) => (
          <Row key={p.label} on={parsed.after === p.after && parsed.before === null} onSelect={() => setRange(p.after, null)}>
            {p.label}
          </Row>
        ))}
        {(facets?.years ?? []).length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">By year</DropdownMenuLabel>
            {(facets?.years ?? []).slice(0, 6).map((y) => (
              <Row key={y.year} count={y.count} on={parsed.after === Date.UTC(y.year, 0, 1) && parsed.before === Date.UTC(y.year + 1, 0, 1)} onSelect={() => setRange(Date.UTC(y.year, 0, 1), Date.UTC(y.year + 1, 0, 1))}>
                {y.year}
              </Row>
            ))}
          </>
        )}
      </Menu>

      <Pill active={parsed.hasAttachment} aria-pressed={parsed.hasAttachment} onClick={() => set("has", parsed.hasAttachment ? null : "file")}>
        <Paperclip className="size-3.5" aria-hidden="true" /> Has file
      </Pill>
      <Pill active={parsed.unread === true} aria-pressed={parsed.unread === true} onClick={() => set("is", parsed.unread === true ? null : "unread")}>
        Unread
      </Pill>

      {(places.length > 1 || parsed.bucket) && (
        <Menu label={parsed.bucket ? bucketName(parsed.bucket as never) : "Where"} active={!!parsed.bucket}>
          {places.map((p) => (
            <Row key={p.bucket} on={parsed.bucket === p.bucket} count={p.count} onSelect={() => set("in", p.bucket)}>
              {bucketName(p.bucket as never)}
            </Row>
          ))}
          {parsed.bucket && (
            <>
              <DropdownMenuSeparator />
              <Row onSelect={() => set("in", null)}>Everywhere</Row>
            </>
          )}
        </Menu>
      )}

      {(mailboxes.length > 1 || parsed.mailbox) && (
        <Menu label={parsed.mailbox ? `Mailbox: ${parsed.mailbox}` : "Mailbox"} active={!!parsed.mailbox}>
          {mailboxes.map((m) => (
            <Row key={m.email} on={parsed.mailbox.toLowerCase() === m.email.toLowerCase()} count={m.count} onSelect={() => set("mailbox", m.email)}>
              {m.email}
            </Row>
          ))}
          {parsed.mailbox && (
            <>
              <DropdownMenuSeparator />
              <Row onSelect={() => set("mailbox", null)}>All mailboxes</Row>
            </>
          )}
        </Menu>
      )}

      {trailing && <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">{trailing}</span>}
    </div>
  );
}
