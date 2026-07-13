# Deploying Furlong to Railway

Full-stack deploy: **web** (Next.js) · **api** (Fastify) · **worker** (automation) ·
**ml** (Python/FastAPI) · **Postgres** · **Redis**. GitHub auto-deploy — Railway
rebuilds each service on every push to `main`.

Repo: `wpf002/furlong`. Config-as-code lives in `railway.api.json`,
`railway.worker.json`, `railway.web.json` (repo root) and `services/ml/railway.json`.

---

## 1. Create the project & databases

1. Railway → **New Project** → **Deploy from GitHub repo** → pick `wpf002/furlong`.
   (This first repo import creates one service — we'll set it up as **api** below,
   then add the others.)
2. In the project, **+ New → Database → Add PostgreSQL**.
3. **+ New → Database → Add Redis**.

## 2. Generate the shared secret

```bash
openssl rand -hex 32      # use the output as AUTH_SECRET (same value on api + worker)
```

## 3. Create the four services

For each, **+ New → GitHub Repo → wpf002/furlong**, then open the service →
**Settings**:

| Service  | Root Directory | Config-as-code file (Settings → "Railway Config File") |
|----------|----------------|--------------------------------------------------------|
| `api`    | `/` (default)  | `railway.api.json`                                     |
| `worker` | `/` (default)  | `railway.worker.json`                                  |
| `web`    | `/` (default)  | `railway.web.json`                                     |
| `ml`     | `services/ml`  | *(auto-detected `services/ml/railway.json`)*           |

Each config file already sets the build + start commands — you only set the
**Root Directory** and **Config File path**, plus the variables below.

## 4. Environment variables

Use Railway **variable references** (`${{Postgres.DATABASE_URL}}`, etc.) so URLs
stay in sync. Set "Public Networking" on **api**, **web**, and **ml** to get public
URLs; **worker** needs no domain.

### api
```
DATABASE_URL      = ${{Postgres.DATABASE_URL}}
REDIS_URL         = ${{Redis.REDIS_URL}}
ML_SERVICE_URL    = http://${{ml.RAILWAY_PRIVATE_DOMAIN}}:8080   # ml internal URL
AUTH_SECRET       = <openssl output from step 2>
JOBS_ENABLED      = true
DISCOVERY_ENABLED = true
JOBS_ADMIN_TOKEN  = <any long random string>
SELF_API_URL      = http://${{RAILWAY_PRIVATE_DOMAIN}}:8080      # this service, internal
# optional (features degrade gracefully if unset):
# ANTHROPIC_API_KEY, ASSISTANT_MODEL, RESEND_API_KEY, ALERT_FROM_EMAIL,
# TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
```

### worker
```
DATABASE_URL      = ${{Postgres.DATABASE_URL}}
REDIS_URL         = ${{Redis.REDIS_URL}}
ML_SERVICE_URL    = http://${{ml.RAILWAY_PRIVATE_DOMAIN}}:8080
AUTH_SECRET       = <same as api>
JOBS_ENABLED      = true
DISCOVERY_ENABLED = true
JOBS_ADMIN_TOKEN  = <same as api>
SELF_API_URL      = http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080  # reach api's /ingest
CRON_DISCOVER     = */15 * * * *
CRON_RETRAIN      = 0 3 * * *    # nightly model retrain + revalue (see below)
```

> **Automated retraining.** The worker registers a repeatable `retrain` schedule
> (`CRON_RETRAIN`, default nightly 03:00 UTC). Each run calls the ML service's
> `POST /train` — retraining the valuation model on all accumulated results (so
> new sales' data *and* the catalog-pedigree feature land) — then re-values every
> upcoming sale so buyers see fresh predictions. Requires `JOBS_ENABLED=true` +
> Redis (the worker service). Trigger one immediately instead of waiting for the
> cron with `POST /model/retrain`, or `POST /jobs/run/retrain` with the
> `x-admin-token` header. Tune the cadence via `CRON_RETRAIN` (BullMQ cron syntax).

### web  (NEXT_PUBLIC_* is baked at BUILD time — set before first build)
```
NEXT_PUBLIC_API_URL = https://${{api.RAILWAY_PUBLIC_DOMAIN}}     # api's public URL
```

### ml
```
# none required to serve; add DATABASE_URL = ${{Postgres.DATABASE_URL}} only if the
# model service is configured to read comparables from the DB.
```

> Railway sets `PORT` per service automatically. The api reads `PORT`, Next reads
> `PORT`, and the ml start command passes `--port $PORT`. The `8080` in the
> internal URLs above is Railway's default internal target port — confirm each
> service's actual target port under Settings → Networking and adjust if needed.

## 5. Deploy order (first time)

1. Deploy **api** first → it runs `prisma migrate deploy` on boot (creates all
   tables) and comes up healthy. Note its public URL.
2. Set **web**'s `NEXT_PUBLIC_API_URL` to that URL, then deploy **web**.
3. Deploy **worker** and **ml** (any order).

After this, every `git push` to `main` redeploys the affected services.

## 6. Verify

- `https://<api>/sales` → JSON list of sales.
- `https://<api>/jobs/status` → `jobsEnabled`/`discoveryEnabled` true, 4 sources.
- `https://<web>/` → the app; `/auction` pages through a catalog.

## Notes

- The api & worker run TypeScript directly via `tsx` (the workspace packages are
  TS source); `tsx` and `prisma` are runtime `dependencies` so prod installs keep
  them.
- Data: a fresh Postgres starts empty. Seed catalogs by letting the worker's
  discovery job run, or run the fetchers/seed scripts against the prod
  `DATABASE_URL`.
- Automation makes live outbound calls to auction-house sites every 15 min
  (`DISCOVERY_ENABLED=true`). Set it to `false` to pause.
