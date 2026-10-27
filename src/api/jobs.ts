// The once-a-minute job is a list of independent jobs run one after another. This is what keeps one of them from taking the others down with it:
//   - a budget each, so a job that has a lot to do stops between units of work and leaves the rest for the next minute;
//   - a hard deadline each, so a job stuck on something that never answers is walked away from instead of waited for;
//   - one run at a time per job, so a job that was walked away from (it is still going) is not started a second time on top of itself;
//   - one line in the log for a job that failed, ran long, was cut off or was skipped, so a stuck job is visible rather than silent.

export class Budget {
  private readonly end: number;
  constructor(readonly ms: number, private readonly clock: () => number = Date.now) {
    this.end = clock() + ms;
  }
  /** True once the time is used up. Loops check this between units of work and stop when it is. */
  get spent(): boolean {
    return this.clock() >= this.end;
  }
  get left(): number {
    return Math.max(0, this.end - this.clock());
  }
}

/** A budget that never runs out, for callers that do not pass one (a test, a manual run). */
export const UNLIMITED = new Budget(Number.MAX_SAFE_INTEGER / 2);

export interface JobOptions {
  /** Soft limit: how long the job should work before it stops taking on more. The default suits a job that makes a few small calls. */
  budgetMs?: number;
  /** How much longer than the budget the job gets before it is cut loose. */
  graceMs?: number;
}

export const DEFAULT_BUDGET_MS = 60_000;
const DEFAULT_GRACE_MS = 30_000;
/** A job that ran this long gets a warning even though it finished. */
const SLOW_MS = 30_000;

const inFlight = new Set<string>();

export type JobOutcome = "ok" | "failed" | "timeout" | "busy";

/**
 * Run one job of the minute. Never throws. Returns how it ended. A job that is cut loose keeps running in the background (nothing can
 * stop a promise); it stays marked as running until it ends, so the next minute skips it rather than doubling up.
 */
export async function runJob(name: string, job: (budget: Budget) => Promise<unknown>, opts: JobOptions = {}): Promise<JobOutcome> {
  if (inFlight.has(name)) {
    console.warn(`job ${name}: skipped, the previous run has not finished yet`);
    return "busy";
  }
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const hardMs = budgetMs + (opts.graceMs ?? DEFAULT_GRACE_MS);
  const started = Date.now();
  inFlight.add(name);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => job(new Budget(budgetMs)))();
  // Whatever happens, the marker comes off when the work really ends, not when we stop waiting for it.
  const finished = work.then(
    () => undefined,
    () => undefined
  ).finally(() => {
    inFlight.delete(name);
  });
  const cutOff = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), hardMs);
  });
  try {
    const first = await Promise.race([work.then(() => "ok" as const), cutOff]);
    if (first === "timeout") {
      console.error(`job ${name}: still running after ${Math.round(hardMs / 1000)} s, moving on without it`);
      return "timeout";
    }
    const took = Date.now() - started;
    if (took >= SLOW_MS) console.warn(`job ${name}: finished but took ${Math.round(took / 1000)} s`);
    return "ok";
  } catch (e) {
    console.error(`job ${name} failed:`, e);
    return "failed";
  } finally {
    clearTimeout(timer);
    void finished;
  }
}
