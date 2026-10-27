import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The imbox wordmark: lowercase, one monoline stroke (5 units, round ends) on a 20-unit x-height.
 * Every letter is a stem or a circle, and the "o" is the logo: half solid (let in), half outline (waiting).
 * Pure vector paths matching public/wordmark.svg with stable clip IDs.
 * `size` is the height of the drawing; the width follows from it.
 */
const SW = 5;
const R_OUT = 10 + SW / 2;
const OX = 91.5;

export function TypoLogo({ size = 28, className, ...rest }: { size?: number; className?: string } & SVGProps<SVGSVGElement>) {
  const width = Math.round(size * 3.36);
  return (
    <svg
      viewBox="-3 3 134.5 40"
      width={width}
      height={size}
      className={cn("inline-block shrink-0 text-foreground select-none", className)}
      aria-label="imbox"
      role="img"
      {...rest}
    >
      <defs>
        <clipPath id="imbox-wm-l">
          <rect x={OX - 30} y="0" width={30 - 1.6} height="46" />
        </clipPath>
        <clipPath id="imbox-wm-r">
          <rect x={OX + 1.6} y="0" width="30" height="46" />
        </clipPath>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="3" cy="9" r={SW * 0.62} fill="currentColor" stroke="none" />
        <path d="M3 20V40" />
        <path d="M14 40V28a7 7 0 0 1 14 0V40M28 28a7 7 0 0 1 14 0V40" />
        <path d="M52 6V40" />
        <circle cx="62" cy="30" r="10" />
        <circle cx={OX} cy="30" r={R_OUT} fill="currentColor" stroke="none" clipPath="url(#imbox-wm-l)" />
        <circle cx={OX} cy="30" r={10} clipPath="url(#imbox-wm-r)" />
        <path d="M111 20L129 40M129 20L111 40" />
      </g>
    </svg>
  );
}
