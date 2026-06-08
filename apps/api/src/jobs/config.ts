/**
 * Phase 2d — automation configuration.
 *
 * Everything here is OFF by default. The product invariant (ROADMAP) is a
 * licensing path, not scraping: nothing polls an auction house until an operator
 * explicitly opts in via env. Two independent flags:
 *
 *   JOBS_ENABLED=true       — boot the BullMQ worker + repeatable schedules.
 *   DISCOVERY_ENABLED=true  — allow the discovery/ingest jobs to reach out to
 *                             auction-house sources. Without it, discovery is a
 *                             no-op even when the worker is running.
 *
 * The manual /jobs/* endpoints run handlers inline and DO require an admin token
 * but do NOT require JOBS_ENABLED (so the pipeline is testable without Redis).
 * Discovery/ingest handlers still honor DISCOVERY_ENABLED regardless of path.
 */

function flag(name: string): boolean {
  return (process.env[name] ?? '').trim().toLowerCase() === 'true';
}

export const jobsConfig = {
  /** Run the worker process + register repeatable cron jobs. */
  get enabled(): boolean {
    return flag('JOBS_ENABLED');
  },
  /** Permit outbound calls to auction-house sources (discovery + ingest). */
  get discoveryEnabled(): boolean {
    return flag('DISCOVERY_ENABLED');
  },
  get redisUrl(): string {
    return process.env.REDIS_URL ?? 'redis://localhost:6380';
  },
  /** Admin token guarding /jobs/* manual triggers. Unset = endpoints disabled. */
  get adminToken(): string | null {
    const t = (process.env.JOBS_ADMIN_TOKEN ?? '').trim();
    return t.length > 0 ? t : null;
  },
  /** Base URL the worker uses to call this API's own ingest endpoints. */
  get selfUrl(): string {
    const port = process.env.API_PORT ?? '4000';
    return process.env.SELF_API_URL ?? `http://localhost:${port}`;
  },
  /** Cron schedules (node-cron / BullMQ repeat syntax). Overridable via env. */
  schedules: {
    // Every 15 min — find newly-announced sales and pull catalogs the moment
    // they drop (near-real-time). Override via CRON_DISCOVER.
    discover: process.env.CRON_DISCOVER ?? '*/15 * * * *',
    // Hourly — fire "sale is N hours out" alerts.
    saleSoon: process.env.CRON_SALE_SOON ?? '0 * * * *',
    // Weekly Sun 03:00 — retrain on accumulated results.
    retrain: process.env.CRON_RETRAIN ?? '0 3 * * 0',
  },
  /** SALE_SOON fires when a sale starts within this many hours. */
  get saleSoonWindowHours(): number {
    const n = Number(process.env.SALE_SOON_WINDOW_HOURS ?? '48');
    return Number.isFinite(n) && n > 0 ? n : 48;
  },
} as const;

export const QUEUE_NAME = 'furlong-jobs';

export type JobName = 'discover' | 'ingest-sale' | 'retrain' | 'sale-soon';

export interface IngestSaleJobData {
  source: string; // adapter key, e.g. "FASIG_TIPTON"
  code: string; // source-specific sale identifier
  saleName: string;
  year: number;
}
