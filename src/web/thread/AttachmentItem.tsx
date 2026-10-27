import { useState } from "react";
import { Download, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { attachmentUrl } from "@/api";
import { fileIcon } from "@/components/Composer";
import { fmtSize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle, ItemActions } from "@/components/ui/item";

export function AttachmentItem({ a }: { a: { id: string; message_id: string; filename: string; mime_type: string; size: number } }) {
  const [broken, setBroken] = useState(false);
  const isImg = a.mime_type.startsWith("image/") && !broken;
  const isCal = a.mime_type.startsWith("text/calendar") || a.mime_type === "application/ics" || /\.ics$/i.test(a.filename) || (/^attachment-\d+$/i.test(a.filename) && a.size < 20000);
  const displayName = isCal && (/^attachment-\d+$/i.test(a.filename) || !a.filename) ? "meeting.ics" : (a.filename || "attachment");
  return (
    <Item variant="muted" size="xs" className="group/att" asChild>
      <a href={attachmentUrl(a.message_id, a.id)} target="_blank" rel="noopener">
        <ItemMedia variant={isImg ? "image" : "icon"} className={cn(!isImg && "text-muted-foreground")}>
          {isImg ? (
            <img src={attachmentUrl(a.message_id, a.id)} alt={displayName} onError={() => setBroken(true)} loading="lazy" />
          ) : isCal ? (
            <CalendarPlus className="size-3.5 text-foreground/80" />
          ) : (
            fileIcon(a.mime_type, a.filename)
          )}
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="text-[13px] truncate">{displayName}</ItemTitle>
          <ItemDescription className="text-xs tnum">{isCal ? "Calendar invite · " : ""}{fmtSize(a.size)}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-xs" className="text-muted-foreground opacity-0 group-hover/att:opacity-100 focus-visible:opacity-100">
                <a href={attachmentUrl(a.message_id, a.id, true)} aria-label={`Download ${displayName}`} onClick={(e) => e.stopPropagation()}>
                  <Download />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>
        </ItemActions>
      </a>
    </Item>
  );
}
