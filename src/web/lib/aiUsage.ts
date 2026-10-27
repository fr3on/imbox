import type { AiUsageData } from "@shared/types";

const DAY = 86_400_000;

/** 1,840,000 -> "1.84M", 12,300 -> "12.3k", 480 -> "480". */
export function fmtTokens(n: number): string {
  const trim = (x: string) => (x.includes(".") ? x.replace(/\.?0+$/, "") : x);
  if (n >= 1_000_000) return `${trim((n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2))}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${trim((n / 1000).toFixed(1))}k`;
  return String(n);
}

/** One entry per day of the period, today last, with the days that had no calls filled in as zero. */
export function fillDays(series: AiUsageData["series"], days: number, now = Date.now()): { day: number; tokens: number }[] {
  const today = Math.floor(now / DAY);
  const byDay = new Map(series.map((s) => [s.day, s.tokens]));
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i);
    return { day, tokens: byDay.get(day) ?? 0 };
  });
}

