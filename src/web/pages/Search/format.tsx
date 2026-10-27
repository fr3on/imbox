import {
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(mime: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext || "")) {
    return <ImageIcon className="size-5 text-sky-600 dark:text-sky-400 shrink-0" />;
  }
  if (mime.includes("pdf") || ext === "pdf") {
    return <FileText className="size-5 text-red-600 dark:text-red-400 shrink-0" />;
  }
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv") || ["csv", "xlsx", "xls"].includes(ext || "")) {
    return <FileSpreadsheet className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  }
  return <File className="size-5 text-muted-foreground shrink-0" />;
}
