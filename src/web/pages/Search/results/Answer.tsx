import { Link } from "react-router-dom";
import { BrandIcon } from "../../../components/BrandIcons";
import type { SearchAnswer } from "../../../api";

export function AnswerSection({
  answer,
}: {
  answer: {
    data?: SearchAnswer;
  };
}) {
  if (!answer.data || answer.data.off || !answer.data.answer) return null;

  return (
    <section className="rounded-xl border border-border/70 bg-muted/40 p-4" aria-label="Answer">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        <BrandIcon name="assistant" size={12} aria-hidden="true" /> Answer · written by AI from your mail
      </div>
      <p className="mt-1.5 text-[14.5px] leading-relaxed">{answer.data.answer}</p>
      {answer.data.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">From</span>
          {answer.data.sources.map((src) => (
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
    </section>
  );
}
