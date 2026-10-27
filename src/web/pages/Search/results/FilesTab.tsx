import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import type { Attachment } from "@shared/types";
import { attachmentUrl } from "../../../api";
import { BrandIcon } from "../../../components/BrandIcons";
import { fileIcon, fmtSize } from "../format";

export function FilesTab({ files, q }: { files: Attachment[]; q: string }) {
  if (files.length === 0) {
    return (
      <div className="text-center py-12 rounded-xl border border-dashed border-border/80">
        <BrandIcon name="files" className="size-8 mx-auto text-muted-foreground/60 mb-2" />
        <div className="font-medium text-sm text-foreground">No files matched “{q}”</div>
        <p className="text-xs text-muted-foreground mt-1">Try searching by filename or file extension.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
      {files.map((f) => (
        <div
          key={f.id}
          className="p-3.5 rounded-xl border border-border/80 bg-card hover:bg-muted/30 transition-all shadow-xs flex flex-col justify-between"
        >
          <Link to={`/t/${f.thread_id}`} className="flex items-start gap-3 mb-3 group">
            <div className="p-2.5 rounded-lg bg-muted border border-border/60 shrink-0">
              {fileIcon(f.mime_type, f.filename)}
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-sm text-foreground truncate block group-hover:underline">
                {f.filename}
              </span>
              <span className="text-xs text-muted-foreground font-mono block mt-0.5">
                {fmtSize(f.size)}
              </span>
              {f.thread_subject && (
                <span className="text-[11px] text-muted-foreground/80 truncate block mt-0.5">
                  in {f.thread_subject}
                </span>
              )}
            </div>
          </Link>
          <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
            <Link
              to={`/t/${f.thread_id}`}
              className="text-muted-foreground hover:text-foreground text-[11px]"
            >
              View thread →
            </Link>
            <a
              href={attachmentUrl(f.message_id, f.id, true)}
              download={f.filename}
              className="inline-flex items-center gap-1 text-xs text-foreground font-medium hover:underline"
            >
              <Download size={12} /> Download
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
