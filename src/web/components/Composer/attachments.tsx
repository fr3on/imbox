import type { ReactNode } from "react";
import { File, FileArchive, FileImage, FileText, X } from "lucide-react";
import { fmtSize } from "../../lib/format";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

export const MAX_ATTACH = 20 * 1024 * 1024;

export interface Att {
  filename: string;
  mime_type: string;
  size: number;
  data_base64: string;
}

export function readFile(f: File): Promise<Att> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read file"));
    r.onload = () => resolve({ filename: f.name, mime_type: f.type || "application/octet-stream", size: f.size, data_base64: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(f);
  });
}

export function fileIcon(mime: string, name = ""): ReactNode {
  if (mime.startsWith("image/")) return <FileImage />;
  if (/zip|rar|7z|tar|gzip/.test(mime) || /\.(zip|rar|7z|tgz)$/i.test(name)) return <FileArchive />;
  if (/pdf|text|word|document|sheet|presentation|csv/.test(mime)) return <FileText />;
  return <File />;
}

export function AttachmentItem({ a, onRemove }: { a: Att; onRemove: () => void }) {
  const isImg = a.mime_type.startsWith("image/");
  return (
    <Item variant="muted" size="xs" className="group/att">
      <ItemMedia variant={isImg ? "image" : "icon"}>
        {isImg ? <img src={`data:${a.mime_type};base64,${a.data_base64}`} alt="" className="size-8 rounded-sm object-cover" /> : fileIcon(a.mime_type, a.filename)}
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-[13px] truncate">{a.filename}</ItemTitle>
        <ItemDescription className="text-xs tnum">{fmtSize(a.size)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="ghost" size="icon-xs" aria-label="Remove attachment" onClick={onRemove} className="text-muted-foreground opacity-0 group-hover/att:opacity-100 focus-visible:opacity-100">
          <X />
        </Button>
      </ItemActions>
    </Item>
  );
}
