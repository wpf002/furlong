/**
 * When to hand this worker's memory back to the operating system.
 *
 * The worker gains a few hundred megabytes a day across ingest, discovery and
 * valuation, and V8 never returns a high-water mark, so it drifts to ~4 GB and
 * sits there. Railway bills memory by the minute, which made a process that is
 * idle most of the day cost $27 a month instead of $3.
 *
 * Moving the retrain into a child process (retrainRunner.ts) removed the single
 * largest peak but not the drift: it is every job, not one. Rather than hunt
 * each retention site in a queue worker that does five unrelated things, the
 * process restarts itself once it is heavy. A fresh process starts at 0.24 GB.
 *
 * The decision is pure so it can be tested without allocating gigabytes.
 */

/** Recycle above this resident size. Well under the ~4 GB ceiling it drifts to,
 *  and far above the 0.24 GB a fresh worker needs, so neither a normal job nor
 *  a single big catalogue trips it. */
export const RECYCLE_RSS_MB = Number(process.env.WORKER_RECYCLE_RSS_MB ?? 900);

/** Never recycle in the first minutes of a process. If a fresh worker were
 *  already over the threshold — a raised baseline, a lowered limit — recycling
 *  on the first job would be a restart loop, and a loop that never drains the
 *  queue is worse than the memory. */
export const RECYCLE_MIN_UPTIME_MS = Number(process.env.WORKER_RECYCLE_MIN_UPTIME_MS ?? 10 * 60 * 1000);

/**
 * What Railway actually bills: the container's memory, not this process's RSS.
 *
 * The first version of this checked `process.memoryUsage().rss` and never once
 * fired — the worker sat at 3.19 GB on the invoice for seven days while Node's
 * own RSS stayed under the threshold. The gap is everything in the cgroup that
 * is not this heap: page cache from reading catalogues and model files, and any
 * child process. The meter is the cgroup, so the decision reads the cgroup.
 *
 * Falls back to process RSS off-container (tests, a laptop), which is the right
 * answer there because there is no cgroup to bill.
 */
export function containerMemoryBytes(readFile = defaultRead): number {
  // cgroup v2, then v1. Both report bytes. A zero, a negative or a non-finite
  // reading is not a measurement — some runtimes expose the file and write
  // nothing useful into it — and accepting one would mean never recycling.
  for (const path of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    const value = readFile(path);
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return process.memoryUsage().rss;
}

function defaultRead(path: string): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const n = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface RecycleCheck {
  rssBytes: number;
  uptimeMs: number;
  thresholdMb?: number;
  minUptimeMs?: number;
}

export function shouldRecycle({
  rssBytes,
  uptimeMs,
  thresholdMb = RECYCLE_RSS_MB,
  minUptimeMs = RECYCLE_MIN_UPTIME_MS,
}: RecycleCheck): boolean {
  if (thresholdMb <= 0) return false; // WORKER_RECYCLE_RSS_MB=0 turns it off
  if (uptimeMs < minUptimeMs) return false;
  return rssBytes / (1024 * 1024) > thresholdMb;
}

/** For the log line, so the reason a worker went away is in the record, and so
 *  the two numbers that disagreed the first time are both visible. */
export function describeRecycle(containerBytes: number): string {
  const gb = (b: number) => (b / (1024 * 1024 * 1024)).toFixed(2);
  return (
    `${gb(containerBytes)} GB in the container (heap ${gb(process.memoryUsage().rss)} GB), ` +
    `over the ${RECYCLE_RSS_MB} MB recycle threshold`
  );
}
