import { Link } from "react-router-dom";
import type { Attachment, MergedContact } from "@shared/types";
import { Avatar } from "../../../components/Avatar";
import { fileIcon, fmtSize } from "../format";
import type { SearchTab } from "../types";

export function AlsoMatching({
  contacts,
  files,
  onSelectTab,
}: {
  contacts: MergedContact[];
  files: Attachment[];
  onSelectTab: (tab: SearchTab) => void;
}) {
  if (contacts.length === 0 && files.length === 0) return null;

  return (
    <section aria-label="Also matching">
      <div className="mb-2 flex items-center gap-3 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Also matching</h2>
        {contacts.length > 2 && (
          <button type="button" onClick={() => onSelectTab("contacts")} className="text-xs text-muted-foreground hover:text-foreground">
            All {contacts.length} people
          </button>
        )}
        {files.length > 3 && (
          <button type="button" onClick={() => onSelectTab("files")} className="text-xs text-muted-foreground hover:text-foreground">
            All {files.length} files
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {contacts.slice(0, 2).map((c) => (
          <Link key={c.id} to={`/contacts/${c.id}`} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2 hover:bg-muted/40">
            <Avatar email={c.email} name={c.name} src={c.avatar_url} size={28} />
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-medium">{c.name || c.email}</div>
              <div className="truncate text-xs text-muted-foreground">{c.message_count ? `${c.message_count} messages` : "Person"}</div>
            </div>
          </Link>
        ))}
        {files.slice(0, 3).map((f) => (
          <Link key={f.id} to={`/t/${f.thread_id}`} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2 hover:bg-muted/40">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted [&>svg]:size-4">{fileIcon(f.mime_type, f.filename)}</span>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-medium">{f.filename || "Untitled"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {fmtSize(f.size)}
                {f.from ? ` · ${f.from.name || f.from.email}` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
