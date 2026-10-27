import { Link } from "react-router-dom";
import { BrandIcon } from "../../../components/BrandIcons";
import type { SearchAnswer } from "../../../api";

export function OverviewSection({
  overview,
}: {
  overview: {
    isLoading: boolean;
    data?: SearchAnswer;
    error?: unknown;
  };
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-muted/40 p-4" aria-label="Overview" aria-busy={overview.isLoading}>
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        <BrandIcon name="assistant" size={12} aria-hidden="true" /> Overview · written by AI from the top results
      </div>
      {overview.isLoading && <p className="mt-1.5 text-[14px] text-muted-foreground">Reading the top results…</p>}
      {overview.data?.off && <p className="mt-1.5 text-[14px] text-muted-foreground">Set up an AI provider in Settings to get overviews.</p>}
      {overview.data && !overview.data.off && !overview.data.answer && (
        <p className="mt-1.5 text-[14px] text-muted-foreground">
          {overview.data.error ? "The overview could not be written. Try again in a moment." : "Nothing to summarize here."}
        </p>
      )}
      {Boolean(overview.error) && <p className="mt-1.5 text-[14px] text-muted-foreground">The overview could not be written.</p>}
      {overview.data?.answer && (
        <>
          <p className="mt-1.5 text-[14.5px] leading-relaxed">{overview.data.answer}</p>
          {overview.data.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">From</span>
              {overview.data.sources.map((src) => (
                <Link
                  key={src.thread_id}
                  to={`/t/${src.thread_id}`}
                  className="max-w-full truncate rounded-full border border-border bg-background px-2.5 py-0.5 text-[12.5px] hover:bg-muted"
                >
                  {src.from}: {src.subject}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
