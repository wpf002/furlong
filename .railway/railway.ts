import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  redis,
  service,
} from "railway/iac";

// Furlong — full-stack deploy. Secrets + composed URLs (AUTH_SECRET,
// JOBS_ADMIN_TOKEN, ML_SERVICE_URL, SELF_API_URL, NEXT_PUBLIC_API_URL) are set
// out-of-band via `railway variables` and marked preserve() here so an apply
// never deletes them and they never land in source. Workspace packages are TS
// source, so api + worker run via tsx in production.
export default defineRailway(() => {
  const repo = "wpf002/furlong";
  const branch = "main";

  const db = postgres("postgres");
  const cache = redis("redis");

  const api = service("api", {
    source: github(repo, { branch }),
    build: "pnpm --filter @furlong/db exec prisma generate",
    start:
      "pnpm --filter @furlong/db exec prisma migrate deploy && pnpm --filter @furlong/api exec tsx src/server.ts",
    env: {
      PORT: "8080",
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      JOBS_ENABLED: "true",
      DISCOVERY_ENABLED: "true",
      AUTH_SECRET: preserve(),
      JOBS_ADMIN_TOKEN: preserve(),
      ML_SERVICE_URL: preserve(),
      SELF_API_URL: preserve(),
    },
  });

  const ml = service("ml", {
    source: github(repo, { branch }),
    rootDirectory: "services/ml",
    start: "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    env: {
      PORT: "8000",
      DATABASE_URL: db.env.DATABASE_URL,
    },
  });

  const worker = service("worker", {
    source: github(repo, { branch }),
    build: "pnpm --filter @furlong/db exec prisma generate",
    start: "pnpm --filter @furlong/api exec tsx src/jobs/worker.ts",
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
      JOBS_ENABLED: "true",
      DISCOVERY_ENABLED: "true",
      CRON_DISCOVER: "*/15 * * * *",
      AUTH_SECRET: preserve(),
      JOBS_ADMIN_TOKEN: preserve(),
      ML_SERVICE_URL: preserve(),
      SELF_API_URL: preserve(),
    },
  });

  const web = service("web", {
    source: github(repo, { branch }),
    build: "pnpm --filter @furlong/web build",
    start: "pnpm --filter @furlong/web start",
    env: {
      PORT: "8080",
      NEXT_PUBLIC_API_URL: preserve(),
    },
  });

  return project("furlong", {
    resources: [db, cache, api, ml, worker, web],
  });
});
