import { BrandIcon } from "./BrandIcons";
import { startGoogleConnect, startMicrosoftConnect } from "../lib/connect";
import { useAccount } from "../context/AccountContext";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Eye,
  File,
  FileSpreadsheet,
  Image as ImageIcon,
  Keyboard,
  Mail,
  Moon,
  PanelLeft,
  Plus,
  ScrollText,
  Sun,} from "lucide-react";
import { useSearch } from "../api";
import { fmtTime } from "../lib/format";
import { Avatar } from "./Avatar";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

type SearchCategory = "all" | "mail" | "contacts" | "files" | "events" | "actions";

const DESTINATIONS: { to: string; label: string; icon: ReactNode; kbd?: string; keywords?: string }[] = [
  { to: "/", label: "Imbox", icon: <BrandIcon name="imbox" /> },
  { to: "/feed", label: "Feed", icon: <BrandIcon name="feed" />, keywords: "updates reading newsletters receipts notices" },
  { to: "/feed?kind=reading", label: "Feed: reading", icon: <BrandIcon name="feed" />, keywords: "reading newsletters" },
  { to: "/feed?kind=receipts", label: "Feed: receipts", icon: <BrandIcon name="paper-trail" />, keywords: "paper trail receipts invoices alerts" },
  { to: "/screener", label: "Screener", icon: <BrandIcon name="screener" />, keywords: "new senders" },
  { to: "/reply-later", label: "Reply Later", icon: <BrandIcon name="reply-later" />, keywords: "focus reply" },
  { to: "/set-aside", label: "Set Aside", icon: <BrandIcon name="set-aside" /> },
  { to: "/bubble-up", label: "Bubble Up", icon: <BrandIcon name="bubble-up" />, keywords: "snooze" },
  { to: "/previously-seen", label: "Previously Seen", icon: <Eye /> },
  { to: "/contacts", label: "Contacts", icon: <BrandIcon name="sender" /> },
  { to: "/clips", label: "Clips", icon: <BrandIcon name="clips" /> },
  { to: "/collections", label: "Collections", icon: <BrandIcon name="collection" /> },
  { to: "/files", label: "Files", icon: <BrandIcon name="files" />, keywords: "attachments" },
  { to: "/labels", label: "Labels", icon: <BrandIcon name="labels" /> },
  { to: "/workflows", label: "Workflows", icon: <BrandIcon name="workflows" />, keywords: "rules automation filters label move snooze" },
  { to: "/logs", label: "Activity log", icon: <ScrollText />, keywords: "history logs audit what happened decisions" },
  { to: "/sent", label: "Sent", icon: <BrandIcon name="sent" /> },
  { to: "/drafts", label: "Drafts", icon: <BrandIcon name="drafts" /> },
  { to: "/scheduled", label: "Scheduled", icon: <BrandIcon name="scheduled" />, keywords: "send later" },
  { to: "/everything", label: "Everything", icon: <Mail /> },
  { to: "/screened-out", label: "Screened out", icon: <BrandIcon name="not-now" /> },
  { to: "/trash", label: "Trash", icon: <BrandIcon name="trash" /> },
  { to: "/calendar", label: "Calendar", icon: <BrandIcon name="calendar" />, kbd: "0", keywords: "events schedule meetings agenda" },
  { to: "/assistant", label: "AI Assistant", icon: <BrandIcon name="assistant" />, kbd: "⌘J", keywords: "ai assistant chat ask copilot" },
  { to: "/ai-usage", label: "AI usage", icon: <Activity />, keywords: "ai usage metrics tokens stats activity agents runs models intelligence cost" },
  { to: "/settings", label: "Settings", icon: <BrandIcon name="settings" /> },
];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return d;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext || "")) {
    return <ImageIcon className="size-4 text-sky-600 dark:text-sky-400 shrink-0" />;
  }
  if (mime.includes("pdf") || ext === "pdf") {
    return <BrandIcon name="paper-trail" className="size-4 text-red-600 dark:text-red-400 shrink-0" />;
  }
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv") || ["csv", "xlsx", "xls"].includes(ext || "")) {
    return <FileSpreadsheet className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  }
  return <File className="size-4 text-muted-foreground shrink-0" />;
}

export function CommandPalette({
  open,
  onClose,
  onCompose,
  onToggleTheme,
  onShortcuts,
  onAssistant,
  theme,
  hasAccount,
}: {
  open: boolean;
  onClose: () => void;
  onCompose: () => void;
  onToggleTheme: () => void;
  onShortcuts: () => void;
  onAssistant?: () => void;
  theme: "light" | "dark" | "system";
  hasAccount?: boolean;
}) {
  const nav = useNavigate();
  const { googleConfigured, microsoftConfigured } = useAccount();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const dq = useDebounced(q.trim(), 200);
  const search = useSearch(hasAccount && open ? dq : "");

  useEffect(() => {
    if (open) {
      setQ("");
      setCategory("all");
    }
  }, [open]);

  const actions = useMemo(
    () => [
      { id: "compose", label: "Compose a new message", icon: <BrandIcon name="write" />, kbd: "c", run: onCompose, keywords: "write new email" },
      ...(onAssistant ? [{ id: "assistant", label: "Focus the Assistant", icon: <BrandIcon name="assistant" />, kbd: "⌘J", run: onAssistant, keywords: "ai chat help" }] : []),
      { id: "toggle-rail", label: "Toggle compact vertical rail", icon: <PanelLeft />, kbd: "⌘B", run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true })), keywords: "sidebar vertical rail collapse compact expand" },
      { id: "connect-imap", label: "Add a mailbox (IMAP/SMTP)", icon: <Plus />, run: () => nav("/settings/accounts?add=imap"), keywords: "mail server imap smtp custom own domain add account stalwart" },
      ...(googleConfigured ? [{ id: "connect", label: "Connect a Gmail account", icon: <Plus />, run: () => startGoogleConnect(), keywords: "google add account" }] : []),
      ...(microsoftConfigured ? [{ id: "connect-ms", label: "Connect an Outlook account", icon: <Plus />, run: () => startMicrosoftConnect(), keywords: "microsoft outlook office365 add account" }] : []),
      { id: "theme", label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: theme === "dark" ? <Sun /> : <Moon />, run: onToggleTheme, keywords: "dark light mode appearance" },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, kbd: "?", run: onShortcuts },
    ],
    [onCompose, onToggleTheme, onShortcuts, onAssistant, theme, googleConfigured, microsoftConfigured, nav],
  );

  const firstPage = search.data?.pages[0];
  const mail = dq ? (search.data?.pages.flatMap((p) => p.threads) ?? []).slice(0, 8) : [];
  const contacts = dq ? (firstPage?.contacts ?? []).slice(0, 5) : [];
  const files = dq ? (firstPage?.files ?? []).slice(0, 5) : [];
  const events = dq ? (firstPage?.events ?? []).slice(0, 4) : [];

  const counts = firstPage?.counts ?? {
    threads: mail.length,
    contacts: contacts.length,
    files: files.length,
    events: events.length,
    total: mail.length + contacts.length + files.length + events.length,
  };

  const go = (fn: () => void) => {
    onClose();
    fn();
  };

  const showMail = category === "all" || category === "mail";
  const showContacts = category === "all" || category === "contacts";
  const showFiles = category === "all" || category === "files";
  const showEvents = category === "all" || category === "events";
  const showActions = category === "all" || category === "actions";

  const categories: { id: SearchCategory; label: string; count?: number }[] = [
    { id: "all", label: "All" },
    { id: "mail", label: "Mail", count: counts.threads },
    { id: "contacts", label: "Contacts", count: counts.contacts },
    { id: "files", label: "Files", count: counts.files },
    { id: "events", label: "Calendar", count: counts.events },
    { id: "actions", label: "Actions" },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Search & commands"
      description="Search mail, contacts, files, calendar, or run an action."
      showCloseButton={false}
      className="sm:max-w-[640px] rounded-2xl overflow-hidden border border-border/80 shadow-2xl p-0"
    >
      <Command loop className="[&_[cmdk-input-wrapper]]:border-b-0">
        <div className="border-b border-border/60 pb-1">
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={hasAccount ? "Search mail, contacts, files, calendar, or actions…" : "Jump anywhere or run an action…"}
            className="text-[14.5px] h-12"
          />
          {/* Quick Scope Filter Chips */}
          {dq && (
            <div className="flex items-center gap-1.5 px-3 pb-2.5 overflow-x-auto scrollbar-none">
              {categories.map((cat) => {
                const isSelected = category === cat.id;
                const hasResults = cat.count !== undefined && cat.count > 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={cn(
                      "px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 transition-all flex items-center gap-1.5",
                      isSelected
                        ? "bg-foreground text-background shadow-2xs font-semibold"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span>{cat.label}</span>
                    {cat.count !== undefined && (
                      <span className={cn("text-[10px] px-1 rounded-full", isSelected ? "bg-background/20 text-background" : hasResults ? "bg-background/80 text-foreground" : "opacity-60")}>
                        {cat.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <CommandList className="max-h-[380px] p-2 space-y-1">
          <CommandEmpty>
            {search.isFetching ? (
              <span className="text-sm text-muted-foreground animate-pulse">Searching everything…</span>
            ) : dq ? (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">No direct matches found in this view.</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-lg border border-border/60 transition-colors"
                  onClick={() => go(() => nav(`/search?q=${encodeURIComponent(dq)}`))}
                >
                  <Mail size={13} /> Open full search for “{dq}”
                </button>
              </div>
            ) : (
              "Type to search across everything or jump to a section."
            )}
          </CommandEmpty>

          {/* 1. CONTACTS */}
          {showContacts && contacts.length > 0 && (
            <CommandGroup heading="People & Contacts">
              {contacts.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`contact ${c.id} ${c.name} ${c.email} ${c.notes}`}
                  onSelect={() => go(() => nav(`/contacts/${c.id}`))}
                  className="gap-3 py-2 px-2.5 rounded-lg cursor-pointer"
                >
                  <Avatar email={c.email} name={c.name} src={c.avatar_url} size={24} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate text-xs sm:text-sm">{c.name || c.email}</span>
                      {c.name && <span className="text-xs text-muted-foreground truncate">{c.email}</span>}
                    </div>
                    {c.notes && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{c.notes}</p>}
                  </div>
                  <CommandShortcut className="text-[11px] text-muted-foreground/70">
                    {c.message_count ? `${c.message_count} msgs` : "Contact"}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* 2. MAIL & THREADS */}
          {showMail && mail.length > 0 && (
            <CommandGroup heading="Mail & Messages">
              {mail.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`mail ${t.id} ${t.subject} ${t.last_from.name} ${t.last_from.email} ${t.snippet}`}
                  onSelect={() => go(() => nav(`/t/${t.id}`))}
                  className="gap-2.5 py-2 px-2.5 rounded-lg cursor-pointer"
                >
                  <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground text-xs sm:text-[13px] max-w-[140px] sm:max-w-[200px]">
                        {t.last_from.name || t.last_from.email}
                      </span>
                      <span className="truncate text-xs text-muted-foreground flex-1">{t.subject || "(no subject)"}</span>
                    </div>
                    {t.snippet && <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">{t.snippet}</p>}
                  </div>
                  <CommandShortcut className="text-[11px] shrink-0">{fmtTime(t.last_message_at)}</CommandShortcut>
                </CommandItem>
              ))}
              {dq && (
                <CommandItem
                  value={`search-all ${dq}`}
                  onSelect={() => go(() => nav(`/search?q=${encodeURIComponent(dq)}`))}
                  className="gap-2 text-xs text-muted-foreground hover:text-foreground py-1.5"
                >
                  <Mail size={13} />
                  <span>See all results for “{dq}”</span>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {/* 3. FILES & ATTACHMENTS */}
          {showFiles && files.length > 0 && (
            <CommandGroup heading="Files & Attachments">
              {files.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`file ${f.id} ${f.filename} ${f.thread_subject || ""}`}
                  onSelect={() => go(() => nav(`/t/${f.thread_id}`))}
                  className="gap-2.5 py-2 px-2.5 rounded-lg cursor-pointer"
                >
                  {fileIcon(f.mime_type, f.filename)}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground text-xs sm:text-[13px] truncate block">{f.filename}</span>
                    {f.thread_subject && (
                      <span className="text-[11px] text-muted-foreground truncate block">in {f.thread_subject}</span>
                    )}
                  </div>
                  <CommandShortcut className="text-[11px] font-mono shrink-0">{fmtSize(f.size)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* 4. CALENDAR EVENTS */}
          {showEvents && events.length > 0 && (
            <CommandGroup heading="Calendar Events">
              {events.map((e) => (
                <CommandItem
                  key={e.id}
                  value={`event ${e.id} ${e.title} ${e.description || ""} ${e.location || ""}`}
                  onSelect={() => go(() => nav("/calendar"))}
                  className="gap-2.5 py-2 px-2.5 rounded-lg cursor-pointer"
                >
                  <div className="size-3.5 rounded-full shrink-0" style={{ backgroundColor: e.calendar_color || "#3b82f6" }} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground text-xs sm:text-[13px] truncate block">{e.title || "Untitled event"}</span>
                    {e.location && <span className="text-[11px] text-muted-foreground truncate block">{e.location}</span>}
                  </div>
                  <CommandShortcut className="text-[11px] shrink-0">
                    {e.all_day ? "All day" : fmtTime(e.starts_at)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* 5. JUMP TO */}
          {showActions && (
            <>
              {(mail.length > 0 || contacts.length > 0 || files.length > 0 || events.length > 0) && <CommandSeparator />}
              <CommandGroup heading="Jump to">
                {DESTINATIONS.map((d) => (
                  <CommandItem key={d.to} value={`go ${d.label} ${d.keywords ?? ""}`} onSelect={() => go(() => nav(d.to))}>
                    {d.icon}
                    <span>{d.label}</span>
                    {d.kbd && <CommandShortcut>{d.kbd}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandSeparator />
              <CommandGroup heading="Actions">
                {actions.map((a) => (
                  <CommandItem key={a.id} value={`act ${a.label} ${a.keywords ?? ""}`} onSelect={() => go(a.run)}>
                    {a.icon}
                    <span>{a.label}</span>
                    {a.kbd && <CommandShortcut>{a.kbd}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>

        {/* Footer helper hints */}
        <div className="border-t border-border/60 px-3 py-2 bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground select-none">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 font-mono text-[10px]">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 font-mono text-[10px]">↵</kbd> open
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 font-mono text-[10px]">esc</kbd> close
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}

