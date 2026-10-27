import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpCircle, ChevronRight, ScrollText, 
} from "lucide-react";
import { api, useCounts, useMeMutations } from "../api";
import { useAccount } from "../context/AccountContext";
import { Avatar } from "../components/Avatar";
import { BrandIcon } from "../components/BrandIcons";
import { ActionSheet } from "./ActionSheet";
import { PRESET_ICON } from "../components/presetIcons";
import { PRESETS, setMenuPreset, useMenuPreset } from "../lib/menuPresets";
import { useUpdateCheck } from "../lib/update";
import { UpdateDialog } from "../components/UpdateDialog";
import { AboutDialog } from "../components/AboutDialog";
import { clearPersistedCache } from "../lib/persistedCache";
import { VERSION } from "@shared/buildInfo";
import { updatesNew } from "../lib/updatesCount";

/**
 * Everything the bottom bar does not hold, as icon tiles grouped by what they are. It is the More screen, and the sheet that the More tab opens
 * over whatever page you are on. The four small dialogs it can open (appearance, menu style, about, update) live in `useMoreDialogs`, so they
 * outlive the sheet: the sheet closes first, then the dialog opens.
 */
export function useMoreDialogs() {
  const [theme, setTheme] = useState(false);
  const [style, setStyle] = useState(false);
  const [about, setAbout] = useState(false);
  const [update, setUpdate] = useState(false);
  return { theme, style, about, update, setTheme, setStyle, setAbout, setUpdate };
}
type Dialogs = ReturnType<typeof useMoreDialogs>;

export function MoreDialogs({ d }: { d: Dialogs }) {
  const { user } = useAccount();
  const { update } = useMeMutations();
  const preset = useMenuPreset();
  const upd = useUpdateCheck();
  const theme = user?.settings?.theme ?? "system";
  const setTheme = (t: "light" | "dark" | "system") => update.mutate({ settings: { ...(user?.settings ?? {}), theme: t } });
  return (
    <>
      <ActionSheet
        open={d.style}
        onOpenChange={d.setStyle}
        title="Menu style"
        description="Which pages sit in the bottom bar. The rest stay under More."
        actions={PRESETS.map((p) => ({ icon: PRESET_ICON[p.id], label: p.label, sub: p.blurb, checked: preset.id === p.id, onSelect: () => setMenuPreset(p.id) }))}
      />
      <UpdateDialog open={d.update} onClose={() => d.setUpdate(false)} info={upd} />
      <AboutDialog open={d.about} onClose={() => d.setAbout(false)} appName="Imbox" />
      <ActionSheet
        open={d.theme}
        onOpenChange={d.setTheme}
        title="Appearance"
        actions={[
          { icon: <BrandIcon name="appearance" />, label: "Light", checked: theme === "light", onSelect: () => setTheme("light") },
          { icon: <BrandIcon name="appearance" />, label: "Dark", checked: theme === "dark", onSelect: () => setTheme("dark") },
          { icon: <BrandIcon name="appearance" />, label: "System", checked: theme === "system", onSelect: () => setTheme("system") },
        ]}
      />
    </>
  );
}

function Tile({ to, icon, label, count, onClick }: { to?: string; icon: ReactNode; label: string; count?: number; onClick?: () => void }) {
  const inner = (
    <>
      <span className="relative flex size-[50px] items-center justify-center rounded-[15px] bg-muted text-foreground [&>svg]:size-[22px]">
        {icon}
        {!!count && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-background bg-foreground px-1 text-[10px] font-semibold leading-none text-background tnum">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      <span className="max-w-full text-[11.5px] leading-tight">{label}</span>
    </>
  );
  const cls = "flex flex-col items-center gap-1.5 rounded-lg py-1 text-center active:opacity-60";
  return to ? (
    <Link to={to} onClick={onClick} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

type Item = { to?: string; icon: ReactNode; label: string; count?: number; run?: () => void };

export function MoreMenu({ d, onDone }: { d: Dialogs; onDone?: () => void }) {
  const { user, accounts } = useAccount();
  const c = useCounts(accounts.length > 0).data;
  const nav = useNavigate();
  const qc = useQueryClient();
  const upd = useUpdateCheck();
  const [find, setFind] = useState("");
  const done = () => onDone?.();
  // A dialog opens after the sheet has gone, so the two never stack.
  const later = (open: () => void) => () => {
    done();
    window.setTimeout(open, 80);
  };
  const logout = async () => {
    await api.post("/auth/logout");
    qc.clear();
    clearPersistedCache();
    nav("/login");
  };

  const groups: { title: string; items: Item[] }[] = [
    {
      title: "Quick",
      items: [
        { to: "/assistant", icon: <BrandIcon name="assistant" />, label: "Assistant" },
        { to: "/search", icon: <BrandIcon name="search" />, label: "Search" },
        { icon: <BrandIcon name="write" />, label: "New message", run: () => nav("/compose") },
      ],
    },
    {
      title: "Streams",
      items: [
        { to: "/feed", icon: <BrandIcon name="feed" />, label: "Feed", count: updatesNew(c) },
        { to: "/screener", icon: <BrandIcon name="screener" />, label: "Screener", count: c?.screener },
        { to: "/previously-seen", icon: <BrandIcon name="let-in" />, label: "Previously seen" },
        { to: "/everything", icon: <BrandIcon name="imbox" />, label: "Everything" },
        { to: "/screened-out", icon: <BrandIcon name="not-now" />, label: "Screened out" },
      ],
    },
    {
      title: "Trays",
      items: [
        { to: "/reply-later", icon: <BrandIcon name="reply-later" />, label: "Reply later", count: c?.reply_later },
        { to: "/set-aside", icon: <BrandIcon name="set-aside" />, label: "Set aside", count: c?.set_aside },
        { to: "/bubble-up", icon: <BrandIcon name="bubble-up" />, label: "Bubble up" },
      ],
    },
    {
      title: "Mail",
      items: [
        { to: "/drafts", icon: <BrandIcon name="drafts" />, label: "Drafts" },
        { to: "/sent", icon: <BrandIcon name="sent" />, label: "Sent" },
        { to: "/scheduled", icon: <BrandIcon name="scheduled" />, label: "Scheduled" },
        { to: "/trash", icon: <BrandIcon name="trash" />, label: "Trash" },
      ],
    },
    {
      title: "Library",
      items: [
        { to: "/calendar", icon: <BrandIcon name="calendar" />, label: "Calendar" },
        { to: "/contacts", icon: <BrandIcon name="sender" />, label: "Contacts" },
        { to: "/files", icon: <BrandIcon name="files" />, label: "Files" },
        { to: "/clips", icon: <BrandIcon name="clips" />, label: "Clips" },
        { to: "/collections", icon: <BrandIcon name="collection" />, label: "Collections" },
        { to: "/labels", icon: <BrandIcon name="labels" />, label: "Labels" },
        { to: "/workflows", icon: <BrandIcon name="workflows" />, label: "Workflows" },
        { to: "/logs", icon: <ScrollText />, label: "Activity" },
      ],
    },
  ];
  const q = find.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, items: q ? g.items.filter((i) => i.label.toLowerCase().includes(q)) : g.items })).filter((g) => g.items.length);
  const theme = user?.settings?.theme ?? "system";

  return (
    <div className="px-4 pb-4">
      <Link to="/settings" onClick={done} className="mb-3 flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5 active:bg-muted">
        <Avatar email={user?.email ?? ""} name={user?.name} src={user?.settings?.avatar_url || accounts.find((a) => a.avatar_url)?.avatar_url} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-medium">{user?.name || user?.email}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">{accounts.length ? `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} connected` : "No mailbox connected yet"}</div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-tertiary" />
      </Link>

      <label className="flex h-10 items-center gap-2 rounded-[10px] bg-muted px-3 text-muted-foreground">
        <BrandIcon name="search" size={16} className="shrink-0" />
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a page" aria-label="Find a page" type="search" className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-tertiary" />
      </label>

      {shown.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className="mb-2 mt-4 px-0.5 font-mono text-[10.5px] uppercase tracking-[0.07em] text-tertiary">{g.title}</h3>
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-3">
            {g.items.map((i) => (
              <Tile key={i.label} to={i.to} icon={i.icon} label={i.label} count={i.count} onClick={() => { done(); i.run?.(); }} />
            ))}
          </div>
        </section>
      ))}
      {shown.length === 0 && <p className="py-8 text-center text-[14px] text-muted-foreground">No page matches “{find}”.</p>}

      <section aria-label="App">
        <h3 className="mb-2 mt-4 px-0.5 font-mono text-[10.5px] uppercase tracking-[0.07em] text-tertiary">App</h3>
        <div className="grid grid-cols-4 gap-x-1.5 gap-y-3">
          <Tile to="/settings" icon={<BrandIcon name="settings" />} label="Settings" onClick={done} />
          <Tile icon={theme === "dark" ? <BrandIcon name="appearance" /> : theme === "light" ? <BrandIcon name="appearance" /> : <BrandIcon name="appearance" />} label="Appearance" onClick={later(() => d.setTheme(true))} />
          <Tile icon={<BrandIcon name="menu-style" />} label="Menu style" onClick={later(() => d.setStyle(true))} />
          <Tile icon={<BrandIcon name="about" />} label="About" onClick={later(() => d.setAbout(true))} />
        </div>
      </section>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[13px] text-muted-foreground">
        {upd.updateAvailable ? (
          <button type="button" onClick={later(() => d.setUpdate(true))} className="flex items-center gap-1.5 rounded-md py-1 text-foreground active:opacity-60 [&>svg]:size-4">
            <ArrowUpCircle /> Update <span className="text-tertiary">v{upd.latest}</span>
          </button>
        ) : (
          <span className="py-1">v{VERSION}</span>
        )}
        <button type="button" onClick={logout} className="flex items-center gap-1.5 rounded-md py-1 text-destructive active:opacity-60 [&>svg]:size-4">
          <BrandIcon name="logout" /> Log out
        </button>
      </div>
      <p className="pt-2 text-center text-[12px] text-muted-foreground">Imbox · {user?.email}</p>
    </div>
  );
}
