import type { SystemInfo } from "@shared/types";
import { fmtSize } from "./format";

/** How full a resource may get before the Server tab says so. */
export const WARN_AT = 90;

export const pct = (used: number, total: number) => (total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0);

export interface ServerHealth {
  ok: boolean;
  /** What is too full, in plain words. Empty when ok. */
  issues: string[];
  /** One line for the top of the tab. */
  line: string;
}

/** Whether the machine has room: processor, memory and disk below the line. */
export function serverHealth(s: SystemInfo): ServerHealth {
  const h = s.host;
  const cpu = h.cpu_percent;
  const mem = pct(h.memory_used, h.memory_total);
  const disk = h.disk_total ? pct(h.disk_used ?? 0, h.disk_total) : null;
  const issues = [
    cpu >= WARN_AT && `Processor ${cpu}% busy`,
    mem >= WARN_AT && `Memory ${mem}% used`,
    disk !== null && disk >= WARN_AT && `Disk ${disk}% full`,
  ].filter((x): x is string => !!x);
  if (issues.length) return { ok: false, issues, line: `${issues.join(", ")}.` };
  const parts = [`Memory ${mem}%`, ...(disk !== null ? [`disk ${disk}%`] : []), `database ${fmtSize(s.database.bytes)}`];
  return { ok: true, issues: [], line: `${parts.join(", ")}. Nothing needs attention.` };
}
