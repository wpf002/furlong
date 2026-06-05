/**
 * /jobs/* — operations surface for the automation pipeline.
 *
 *   GET  /jobs/status            — flags, schedules, registered sources, queue depth
 *   POST /jobs/run/:name         — run a handler INLINE (no Redis needed)
 *
 * Manual triggers run handlers synchronously so the pipeline is testable without
 * a worker/Redis. They are guarded by an admin token (JOBS_ADMIN_TOKEN); if it
 * is unset the endpoints are disabled. Discovery/ingest still honor
 * DISCOVERY_ENABLED inside the handlers, so this can never start scraping just
 * because someone holds the admin token.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jobsConfig, type IngestSaleJobData } from '../jobs/config.js';
import { sourceAdapters } from '../jobs/sources/index.js';
import {
  runDiscover,
  runIngestSale,
  runRetrain,
  runSaleSoon,
} from '../jobs/handlers.js';

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const token = jobsConfig.adminToken;
  if (!token) {
    reply.status(503).send({ error: 'jobs admin disabled — set JOBS_ADMIN_TOKEN to enable' });
    return false;
  }
  const provided = req.headers['x-admin-token'];
  if (provided !== token) {
    reply.status(401).send({ error: 'invalid or missing x-admin-token' });
    return false;
  }
  return true;
}

export async function registerJobRoutes(app: FastifyInstance) {
  app.get('/jobs/status', async () => {
    let queue: { waiting: number; active: number; completed: number; failed: number } | null = null;
    if (jobsConfig.enabled) {
      try {
        const { getQueue } = await import('../jobs/queue.js');
        const counts = await getQueue().getJobCounts('waiting', 'active', 'completed', 'failed');
        queue = {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
        };
      } catch {
        queue = null; // Redis unreachable — report null rather than 500.
      }
    }
    return {
      jobsEnabled: jobsConfig.enabled,
      discoveryEnabled: jobsConfig.discoveryEnabled,
      adminConfigured: jobsConfig.adminToken != null,
      schedules: jobsConfig.schedules,
      saleSoonWindowHours: jobsConfig.saleSoonWindowHours,
      sources: sourceAdapters.map((a) => ({ key: a.key, label: a.label })),
      queue,
    };
  });

  app.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
    '/jobs/run/:name',
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { name } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;

      switch (name) {
        case 'discover': {
          // Inline: ingest each discovered new sale immediately.
          const ingested: unknown[] = [];
          const summaries = await runDiscover(async (d) => {
            ingested.push(await runIngestSale(d));
          });
          return { ran: 'discover', summaries, ingested };
        }
        case 'ingest-sale': {
          const { source, code, saleName, year } = body as Partial<IngestSaleJobData>;
          if (!source || !code) {
            return reply.status(400).send({ error: 'source and code are required' });
          }
          return runIngestSale({
            source,
            code,
            saleName: saleName ?? code,
            year: Number(year) || new Date().getUTCFullYear(),
          });
        }
        case 'retrain':
          return runRetrain(typeof body.saleId === 'string' ? body.saleId : undefined);
        case 'sale-soon':
          return runSaleSoon();
        default:
          return reply
            .status(400)
            .send({ error: `unknown job "${name}" (discover|ingest-sale|retrain|sale-soon)` });
      }
    },
  );
}
