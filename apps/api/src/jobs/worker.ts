/**
 * Worker entrypoint — `pnpm --filter @furlong/api worker`.
 *
 * Processes the furlong-jobs queue and registers the repeatable schedules
 * (discover / sale-soon / retrain). Runs as a SEPARATE process from the API so a
 * long retrain never blocks request handling. Boots only when JOBS_ENABLED=true;
 * otherwise it exits immediately with a hint, keeping automation strictly
 * opt-in (ROADMAP: licensing path, not scraping).
 */
import { Worker, type Job } from 'bullmq';
import { QUEUE_NAME, jobsConfig, type IngestSaleJobData } from './config.js';
import { getConnection, getQueue, enqueue, closeQueue } from './queue.js';
import {
  runDiscover,
  runIngestSale,
  runRetrain,
  runSaleSoon,
} from './handlers.js';

async function processJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case 'discover':
      // New sales found by discovery are enqueued as their own ingest jobs.
      return runDiscover((d) => enqueue('ingest-sale', { ...d }, `ingest:${d.source}:${d.code}`));
    case 'ingest-sale':
      return runIngestSale(job.data as IngestSaleJobData);
    case 'retrain':
      return runRetrain((job.data as { saleId?: string })?.saleId);
    case 'sale-soon':
      return runSaleSoon();
    default:
      throw new Error(`unknown job: ${job.name}`);
  }
}

async function registerSchedules(): Promise<void> {
  const queue = getQueue();
  const common = { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } };
  // upsertJobScheduler is idempotent — safe to call every boot.
  await queue.upsertJobScheduler(
    'sched-discover',
    { pattern: jobsConfig.schedules.discover },
    { name: 'discover', opts: common },
  );
  await queue.upsertJobScheduler(
    'sched-sale-soon',
    { pattern: jobsConfig.schedules.saleSoon },
    { name: 'sale-soon', opts: common },
  );
  await queue.upsertJobScheduler(
    'sched-retrain',
    { pattern: jobsConfig.schedules.retrain },
    { name: 'retrain', opts: common },
  );
}

async function main(): Promise<void> {
  if (!jobsConfig.enabled) {
    // eslint-disable-next-line no-console
    console.log(
      '[worker] JOBS_ENABLED is not set — automation is off. ' +
        'Set JOBS_ENABLED=true (and DISCOVERY_ENABLED=true to allow source polling) to start.',
    );
    process.exit(0);
  }

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: getConnection(),
    concurrency: 2,
  });

  worker.on('completed', (job, result) => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ✓ ${job.name}#${job.id}`, JSON.stringify(result)?.slice(0, 300));
  });
  worker.on('failed', (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[worker] ✗ ${job?.name}#${job?.id}: ${err.message}`);
  });

  await registerSchedules();
  // eslint-disable-next-line no-console
  console.log(
    `[worker] up. discovery=${jobsConfig.discoveryEnabled ? 'on' : 'off'} ` +
      `schedules: discover="${jobsConfig.schedules.discover}" ` +
      `sale-soon="${jobsConfig.schedules.saleSoon}" retrain="${jobsConfig.schedules.retrain}"`,
  );

  const shutdown = async () => {
    await worker.close();
    await closeQueue();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err);
  process.exit(1);
});
