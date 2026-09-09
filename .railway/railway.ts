import { defineRailway, postgres, preserve, project, redis, service } from 'railway/iac';

// Furlong — full-stack deploy. Services deploy via `railway up` (CLI upload),
// not a GitHub source, so there's no GitHub-App dependency. Secrets + composed
// URLs (AUTH_SECRET, JOBS_ADMIN_TOKEN, ML_SERVICE_URL, SELF_API_URL,
// NEXT_PUBLIC_API_URL) are set out-of-band via `railway variables` and marked
// preserve() so an apply never deletes them or leaks them into source.
// Workspace packages are TS source, so api + worker run via tsx in production.
export default defineRailway(() => {
  const db = postgres('postgres');
  const cache = redis('redis');

  const api = service('api', {
    build: 'pnpm --filter @furlong/db exec prisma generate',
    start:
      'pnpm --filter @furlong/db exec prisma migrate deploy && pnpm --filter @furlong/api exec tsx src/server.ts',
    env: {
      PORT: '8080',
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      JOBS_ENABLED: 'true',
      DISCOVERY_ENABLED: 'true',
      AUTH_SECRET: preserve(),
      JOBS_ADMIN_TOKEN: preserve(),
      ML_SERVICE_URL: preserve(),
      SELF_API_URL: preserve(),
      ANTHROPIC_API_KEY: preserve(),
    },
  });

  const ml = service('ml', {
    rootDirectory: 'services/ml',
    start: 'uvicorn app.main:app --host 0.0.0.0 --port $PORT',
    env: {
      PORT: '8000',
      DATABASE_URL: db.env.DATABASE_URL,
      // Pin OpenMP to one thread. Counter-intuitive but measured (sklearn
      // 1.5.2, 120k x 21 features, the shapes this service actually sees):
      //
      //   training, 28 fits   7 threads 25s   1 thread 31s   (early-stops ~105
      //                       of max_iter=400, so both beat /train's "~40s")
      //   one /value call     7 threads 12.85ms   1 thread 11.20ms
      //
      // Threads do nothing for us and cost 7x the billed vCPU. /value predicts
      // ONE row against 14 models, so OpenMP fan-out is pure spawn/join
      // overhead — single-threaded is actually faster. The 2026-09-09 retrain
      // held 7.06 vCPU for 4h45m (03:00-07:45 UTC) at flat memory, which is
      // runRetrain's sequential per-hip /value loop keeping this service
      // permanently busy, NOT the fits. See revalueSale.ts — the real fix is
      // batching that loop; this variable just stops it burning every core.
      OMP_NUM_THREADS: '1',
    },
  });

  const worker = service('worker', {
    build: 'pnpm --filter @furlong/db exec prisma generate',
    start: 'pnpm --filter @furlong/api exec tsx src/jobs/worker.ts',
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      JOBS_ENABLED: 'true',
      DISCOVERY_ENABLED: 'true',
      CRON_DISCOVER: '*/15 * * * *',
      // Nightly 03:00 UTC: retrain the valuation model on all accumulated
      // results (so the catalog-pedigree feature and every new sale's data land)
      // and re-value upcoming sales. Declared here so the schedule is explicit
      // and tunable per environment, not an implicit code default.
      CRON_RETRAIN: '0 3 * * *',
      AUTH_SECRET: preserve(),
      JOBS_ADMIN_TOKEN: preserve(),
      ML_SERVICE_URL: preserve(),
      SELF_API_URL: preserve(),
    },
  });

  const web = service('web', {
    build: 'pnpm --filter @furlong/web build',
    start: 'pnpm --filter @furlong/web start',
    env: {
      PORT: '8080',
      NEXT_PUBLIC_API_URL: preserve(),
    },
  });

  return project('furlong', {
    resources: [db, cache, api, ml, worker, web],
  });
});
