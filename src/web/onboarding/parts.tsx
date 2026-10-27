import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ProviderOption({
  icon,
  title,
  description,
  badge,
  badgeVariant = "secondary",
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: "secondary" | "outline" | "default";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-all hover:border-foreground/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-foreground">{title}</span>
          {badge ? (
            <Badge variant={badgeVariant} className="text-[10px] font-normal py-0 px-1.5 h-4.5">
              {badge}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  );
}

/** Value proposition feature card shown in Step 3 */
export function FeatureBenefit({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-border/70 bg-card/60 p-3.5 text-left">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground leading-normal">{description}</p>
      </div>
    </div>
  );
}
