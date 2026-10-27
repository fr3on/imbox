import { Link } from "react-router-dom";
import { Paperclip } from "lucide-react";
import type { ContactInsights } from "../api";
import { fmtDate, fmtSize } from "../lib/format";

// The files you swapped with this person. The caller leaves it out when there are none.

export function ContactStory({ data }: { data: ContactInsights }) {
  const { files, file_count } = data;

  return (
    <section aria-label="Files">
      {files.length > 0 && (
        <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold">Files</h2>
            <span className="text-xs text-muted-foreground tnum">{file_count}</span>
          </div>
          <ul className="mt-1.5">
            {files.map((f) => (
              <li key={f.id} className="border-t border-border/60 first:border-t-0">
                <Link to={`/t/${f.thread_id}`} className="flex min-w-0 items-center gap-3 py-2 text-[13.5px]">
                  <Paperclip size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{f.filename || "Untitled"}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground tnum sm:inline">{fmtSize(f.size)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tnum">{fmtDate(f.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {file_count > files.length && (
            <p className="mt-1 text-xs text-muted-foreground tnum">and {file_count - files.length} more</p>
          )}
        </div>
      )}
    </section>
  );
}
