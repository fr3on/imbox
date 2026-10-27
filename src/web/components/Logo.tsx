import { cn } from "@/lib/utils";
import { brandMonogram, isDefaultBrand } from "@shared/brand";
import { useAccount } from "../context/AccountContext";

/**
 * The mark. For the default brand it is Imbox's own, the Threshold: a disc half solid (let in) and half outline (still waiting).
 * For any other name it is a tile with the name's first two characters ("ac" for acme), in monospace.
 * Monochrome either way — the tile uses the foreground color, the glyph the background color, so it
 * inverts in dark mode.
 */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  const { appName } = useAccount();
  if (isDefaultBrand(appName)) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden>
        <rect width="64" height="64" rx="16" className="fill-foreground" />
        <g transform="translate(-1)">
          <path d="M30 14A18 18 0 0 0 30 50Z" className="fill-background" />
          <path d="M36 14A18 18 0 0 1 36 50Z" fill="none" className="stroke-background" strokeWidth="4.5" strokeLinejoin="round" />
        </g>
      </svg>
    );
  }
  const m = brandMonogram(appName);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden>
      <rect width="64" height="64" rx="16" className="fill-foreground" />
      <text
        x="32"
        y="32"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-background"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontWeight="700"
        fontSize={m.length > 1 ? 27 : 36}
      >
        {m}
      </text>
    </svg>
  );
}

export { TypoLogo } from "./TypoLogo";
import { TypoLogo } from "./TypoLogo";

export function Wordmark({ className, size = 20, typo = false }: { className?: string; size?: number; typo?: boolean }) {
  const { appName, brandReady } = useAccount();
  if (typo || isDefaultBrand(appName)) {
    return <TypoLogo size={size} className={cn(!brandReady && "invisible", className)} />;
  }
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-[-0.01em]", className)}>
      <Mark size={size} className={cn(!brandReady && "invisible")} />
      <span className={cn(!brandReady && "invisible")}>{appName}</span>
    </span>
  );
}
