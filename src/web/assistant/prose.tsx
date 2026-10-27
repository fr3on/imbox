import { cn } from "@/lib/utils";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useMemo } from "react";

export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Tiny markdown: paragraphs, "- " bullets, **bold**, `code`. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => text.replace(/\r/g, "").split(/\n{2,}/).filter((b) => b.trim()), [text]);
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, i) => (p.startsWith("**") ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong> : p.startsWith("`") ? <code key={i} className="font-mono text-[12px] bg-muted rounded px-1">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>));
  };
  return (
    <div className={cn("text-[14px] leading-6 space-y-2", className)}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={i} className="space-y-1 pl-4 list-disc marker:text-muted-foreground">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={i} className="space-y-1 pl-5 list-decimal marker:text-muted-foreground">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}
            </ol>
          );
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </div>
  );
}

export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 h-6" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}

export function ToolLine({ status, summary }: { status: "running" | "done" | "error"; summary: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-0.5">
      {status === "running" ? <Loader2 className="size-3 animate-spin" /> : status === "error" ? <TriangleAlert className="size-3" /> : <Check className="size-3" />}
      <span className="truncate">{summary}</span>
    </div>
  );
}
