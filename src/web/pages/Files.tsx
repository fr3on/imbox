import { BrandIcon } from "../components/BrandIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, File, FileArchive, FileImage, FileSpreadsheet, FileText, Film, MessageSquare, Music, Presentation } from "lucide-react";
import type { Attachment } from "@shared/types";
import { cn } from "@/lib/utils";
import { attachmentUrl, useFiles } from "../api";
import { EmptyState, ErrorState, PageHeader } from "../components/EmptyState";
import { LoadMore } from "../components/ThreadList";
import { fmtSize, fmtDate } from "../lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useItemCursor } from "../lib/cardKeys";
import { pdfThumb } from "../lib/pdfThumb";
import { Input } from "@/components/ui/input";

export type FileKind = "image" | "pdf" | "document" | "slides" | "spreadsheet" | "archive" | "video" | "audio" | "other";
type Filter = "all" | "image" | "pdf" | "document" | "spreadsheet" | "archive" | "media" | "other";

export function kindOf(mime: string, name: string): FileKind {
  const n = name.toLowerCase();
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.includes("presentation") || m.includes("powerpoint") || /\.(pptx?|key)$/.test(n)) return "slides";
  if (m.includes("spreadsheet") || m.includes("excel") || m === "text/csv" || /\.(xlsx?|csv|numbers)$/.test(n)) return "spreadsheet";
  if (m.includes("word") || m.includes("document") || m.startsWith("text/") || m.includes("rtf") || /\.(docx?|txt|md|rtf|pages)$/.test(n)) return "document";
  if (m.includes("zip") || m.includes("compressed") || m.includes("tar") || /\.(zip|rar|7z|tar|gz|tgz)$/.test(n)) return "archive";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "other";
}

const KIND_ICON: Record<FileKind, React.ReactNode> = {
  image: <FileImage />,
  pdf: <FileText />,
  document: <FileText />,
  slides: <Presentation />,
  spreadsheet: <FileSpreadsheet />,
  archive: <FileArchive />,
  video: <Film />,
  audio: <Music />,
  other: <File />,
};

function matches(k: FileKind, f: Filter) {
  if (f === "all") return true;
  if (f === "media") return k === "video" || k === "audio";
  if (f === "document") return k === "document" || k === "slides";
  return k === f;
}

function ext(name: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1].toUpperCase() : "";
}

/** Page one of a PDF, drawn once the tile scrolls near the screen. Null until then, and when it cannot be drawn. */
function usePdfThumb(url: string, wanted: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!wanted || !el) return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        void pdfThumb(url).then((d) => live && setSrc(d));
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [url, wanted]);
  return { ref, src };
}

export function FileTile({ f, focused, copies = 1 }: { f: Attachment; delay?: number; focused?: boolean; copies?: number }) {
  const k = kindOf(f.mime_type, f.filename);
  const url = attachmentUrl(f.message_id, f.id);
  const [broken, setBroken] = useState(false);
  const thumb = usePdfThumb(url, k === "pdf");
  return (
    <article className={cn("group relative flex flex-col min-w-0 rounded-md scroll-mt-20", focused && "ring-1 ring-ring")}>
      <a href={url} target="_blank" rel="noopener" className="relative block aspect-[4/3] rounded-md bg-muted overflow-hidden">
        {k === "image" && !broken ? (
          <img src={url} alt={f.filename} loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
        ) : thumb.src ? (
          <img src={thumb.src} alt="" className="absolute inset-x-0 top-0 w-full rounded-md bg-white object-cover object-top" style={{ height: "100%" }} />
        ) : (
          <div ref={thumb.ref} className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground [&>svg]:size-6">
            {KIND_ICON[k]}
            {ext(f.filename) && <span className="text-[11px] tracking-wide">{ext(f.filename)}</span>}
          </div>
        )}
        {copies > 1 && <span className="absolute left-1.5 top-1.5 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground tnum">{copies} messages</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={attachmentUrl(f.message_id, f.id, true)}
              className="absolute top-1.5 right-1.5 size-7 rounded-md bg-background/90 text-muted-foreground hover:text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
              aria-label="Download"
            >
              <Download size={14} />
            </a>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
      </a>
      <div className="px-0.5 pt-2">
        <div className="text-[13px] font-medium truncate" title={f.filename}>{f.filename || "attachment"}</div>
        <div className="text-xs text-muted-foreground truncate tnum mt-0.5">
          {fmtSize(f.size)} · {fmtDate(f.created_at)}{f.from ? ` · ${f.from.name || f.from.email}` : ""}
        </div>
        {f.thread_subject && (
          <Link to={`/t/${f.thread_id}`} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground min-w-0">
            <MessageSquare size={11} className="shrink-0" />
            <span className="truncate">{f.thread_subject}</span>
          </Link>
        )}
      </div>
    </article>
  );
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "pdf", label: "PDFs" },
  { value: "document", label: "Docs" },
  { value: "spreadsheet", label: "Sheets" },
  { value: "archive", label: "Archives" },
  { value: "media", label: "Media" },
  { value: "other", label: "Other" },
];

type Sort = "newest" | "largest" | "sender";
const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "largest", label: "Largest" },
  { value: "sender", label: "Sender" },
];

interface Stack {
  f: Attachment;
  copies: number;
}

/** The same file sent in several messages is one tile, shown at its newest copy. */
function stackCopies(files: Attachment[]): Stack[] {
  const by = new Map<string, Stack>();
  for (const f of files) {
    const key = `${f.filename.trim().toLowerCase()}|${f.size}`;
    const hit = by.get(key);
    if (!hit) by.set(key, { f, copies: 1 });
    else {
      hit.copies += 1;
      if (f.created_at > hit.f.created_at) hit.f = f;
    }
  }
  return [...by.values()];
}

const senderOf = (f: Attachment) => (f.from?.name || f.from?.email || "").toLowerCase();

export default function FilesPage() {
  const q = useFiles();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.files) ?? [], [q.data]);
  const stacks = useMemo(() => stackCopies(all), [all]);
  const merged = all.length - stacks.length;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const stackList = useMemo(() => {
    const out = stacks.filter(({ f }) => {
      if (!matches(kindOf(f.mime_type, f.filename), filter)) return false;
      const hay = `${f.filename} ${f.from?.name ?? ""} ${f.from?.email ?? ""} ${f.thread_subject ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (sort === "largest") out.sort((a, b) => b.f.size - a.f.size);
    else if (sort === "sender") out.sort((a, b) => senderOf(a.f).localeCompare(senderOf(b.f)) || b.f.created_at - a.f.created_at);
    else out.sort((a, b) => b.f.created_at - a.f.created_at);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stacks, filter, search, sort]);
  const list = stackList.map((s) => s.f);
  const { cursor } = useItemCursor({
    count: list.length,
    onOpen: (i) => list[i] && window.open(attachmentUrl(list[i].message_id, list[i].id), "_blank", "noopener"),
  });
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !q.isFetchingNextPage) q.fetchNextPage();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, list.length]);
  const total = stacks.reduce((s, x) => s + x.f.size, 0);
  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader
        title="Files"
        subtitle="Every attachment anyone has ever sent you, in one place."
        actions={all.length > 0 ? <span className="text-xs text-muted-foreground tnum">{stacks.length} files · {fmtSize(total)}{merged > 0 ? ` · ${merged} copies merged` : ""}</span> : undefined}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <BrandIcon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input placeholder="Search files, senders, subjects" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search files" className="pl-8" />
        </div>
        <ToggleGroup type="single" size="sm" value={sort} onValueChange={(v) => v && setSort(v as Sort)} aria-label="Sort by">
          {SORTS.map((x) => (
            <ToggleGroupItem key={x.value} value={x.value} className="text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground">{x.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="mb-4 px-2 overflow-x-auto [scrollbar-width:none]">
        <ToggleGroup type="single" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="w-max">
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className={cn("text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground")}>{f.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 px-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-md" />
          ))}
        </div>
      )}
      {!q.isLoading && list.length === 0 && !q.error && (
        <EmptyState
          icon={<File />}
          title={words.length ? "No file matches." : filter === "all" ? "No files yet." : `No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} here.`}
          body={words.length ? "Try part of the name, or the sender." : filter === "all" ? "Attachments show up here as your mail syncs." : "Try another type, or clear the filter."}
        />
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-5 px-2">
        {stackList.map(({ f, copies }, i) => (
          <div key={f.id} data-item-index={i} data-focused={cursor === i || undefined}>
            <FileTile f={f} focused={cursor === i} copies={copies} />
          </div>
        ))}
      </div>
      <div ref={sentinel} />
      <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
    </div>
  );
}
