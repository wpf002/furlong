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
      // The nightly /train fits 28 HistGradientBoostingRegressors (2 markets x
      // {price, value} x 7 quantiles). sklearn's OpenMP backend defaults to
      // every core the container sees — measured at 7.06 vCPU sustained for 5h
      // on the 2026-09-09 run, which is the single largest line item on the
      // Railway bill. Histogram building is memory-bandwidth bound, so those
      // last 3 threads buy very little wall-clock for 43% more billed vCPU.
      // 4 threads keeps the worst case (perfect scaling => 8.75h) well inside
      // the 24h gap before the next 03:00 UTC run. Thread count does not change
      // model output: random_state is pinned and only float accumulation order
      // in the histogram sums varies, far below the model's MAE.
      OMP_NUM_THREADS: '4',
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
