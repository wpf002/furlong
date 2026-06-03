# Furlong

Racehorse buyer intelligence platform. Ingests auction catalogs, scores every
hip against a buyer's budget and criteria, and predicts intrinsic value vs.
likely sale price — getting smarter after every sale that runs.

MVP target: **Keeneland September Yearling Sale**. Target user: a syndicate or
first-time owner with a $50K–$300K budget and no full-time bloodstock agent.

## Architecture

| Path            | Stack                       | Role                                    |
| --------------- | --------------------------- | --------------------------------------- |
| `apps/web`      | Next.js 15 + Tailwind       | Buyer UI: search, shortlist, valuations |
| `apps/api`      | Fastify 5                   | API + catalog ingestion orchestration   |
| `packages/db`   | Prisma 7 + Postgres 16      | Data store (money in integer cents)     |
| `packages/shared` | zod                       | Shared schemas across api/web/ingest    |
| `services/ml`   | Python FastAPI + LightGBM   | PDF parsing + deterministic valuation   |

Pricing is deterministic and auditable in the ML service. An LLM is used only
(optionally) to phrase plain-English valuation summaries — never to set a price.

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # Postgres + Redis via docker
pnpm db:generate
pnpm db:migrate
pnpm dev               # web (3000) + api (4000)
pnpm ml:dev            # ML service (8000), separate terminal
```

## Data & licensing

Catalog and results data is licensed/restricted. Do not commit raw catalogs or
scrape without permission — `data/` is gitignored. The path to a real product
is a data agreement with Keeneland / Fasig-Tipton, not bulk scraping.

## Model honesty

The model scores **pedigree and market comparables**, not physical condition or
veterinary status (private data). Predictions are bands with confidence, and
thin-data hips are flagged `limitedComparables`. Buyers still inspect horses.

## Roadmap

- **Phase 1** — Keeneland catalog parser + historical results compile + baseline comparables model + ranked search UI
- **Phase 2** — LightGBM model, hidden-gem score, sire/consignor stats, post-sale retrain (recursive loop)
- **Phase 3** — Buyer profiles, shortlists, alerts, auction calendar
- **Phase 4** — Fasig-Tipton, then Tattersalls/Goffs; horses in training; broodmares
