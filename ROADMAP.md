# Furlong — Roadmap

Catalog-to-shortlist intelligence for yearling buyers. The throughline across
every phase is the **recursive learning loop**: ingest catalogs → predict →
ingest actual results after the sale → retrain → predictions improve. Each phase
is gated — don't start the next until the previous phase's acceptance criteria
pass.

**Locked invariants (never violated, any phase):**

- All money is integer cents (`BigInt`). No floats touch money, ever.
- Pricing is deterministic in `services/ml`. An LLM may phrase a summary; it never sets a number.
- Thin-data hips carry a `limitedComparables` flag end to end. The UI never fakes precision.
- Raw catalogs/results stay out of git (`data/` is ignored). The product assumes a licensing path, not scraping.

---

## Phase 0 — Foundation ✅ (complete)

The scaffold. Done in the bootstrap.

- pnpm 9 + Turbo monorepo: `apps/web`, `apps/api`, `packages/db`, `packages/shared`, `packages/config`, `services/ml`.
- Prisma schema: `Horse` (self-referential pedigree), `Sale`, `Hip`, `SaleResult`, `Valuation`, `SireStats`, `Consignor`, `Breeder`, `User`, `BuyerProfile`, `Shortlist`.
- Fastify API stubs, Next.js shell, Python FastAPI ML service stubs.
- Docker compose for Postgres 16 + Redis 7.

**Acceptance:** `pnpm dev` serves web + api, `pnpm db:migrate` applies clean, `uvicorn` boots the ML service, all `/health` endpoints return ok.

---

## Phase 1 — Catalog Intelligence Engine (the MVP)

One sale, one auction house, one persona. **Keeneland September Yearling Sale.**
Target user: a syndicate or first-time owner with a $50K–$300K budget and no
full-time bloodstock agent. Ship this and put it in front of 5 real buyers.

### 1a. Catalog parser (`services/ml/app/parsing/keeneland.py`)
- Open the catalog PDF with `pdfplumber`; walk pages, detect session headers and per-hip blocks.
- Extract per hip: hip number, session, horse name, sex, color, foaling year, sire, dam, damsire, consignor, breeder.
- Emit records validated against `ParseCatalogResponseSchema` in `@furlong/shared`.
- Handle the two failure modes explicitly: a block that won't parse (log + skip, never silently drop) and a field that's missing (null, not guessed).

### 1b. Ingestion pipeline (`apps/api/src/ingest`)
- Endpoint: upload catalog PDF → call ML `/parse-catalog` → upsert `Sale`, `Horse` (with sire/dam horses created/linked), `Consignor`, `Breeder`, `Hip`.
- Entity resolution: match sires/dams/consignors to existing rows by normalized name so the same sire across years is one `Horse` row. This is the backbone of the learning loop — get it right here.
- Idempotent re-ingest: re-uploading the same catalog updates, never duplicates (`@@unique([saleId, hipNumber])`).

### 1c. Historical results compile
- Manually compile 5–7 years of Keeneland September results into `SaleResult` (hip, price cents, RNA flag, buyer). Tedious but one-time and doable for one sale.
- This is the training label set. RNAs are kept and modeled — "not sold" is signal, not absence.

### 1d. Baseline valuation (comparables, not ML yet)
- In `services/ml/app/valuation/model.py`: predict a price band from comparables — median price for hips with similar sire + sale session + consignor tier, adjusted for year-over-year market trend.
- Label it clearly in the UI as "based on historical averages." This ships fast and is useful immediately; the real model replaces it in Phase 2.
- Output the full `ValuationResponse`: value band, price band, confidence, `limitedComparables`.

### 1e. Ranked search UI (`apps/web`)
- Buyer inputs budget + optional sire preferences (or "best value under $150K").
- Returns a ranked, filterable hip list: estimated value range, predicted sale price range, confidence, and a plain-English one-liner on why each hip is or isn't interesting.
- Hip detail view: pedigree (sire / dam / damsire), consignor, breeder, valuation bands with the comparables-based disclaimer.

### 1f. Post-sale retrain seed
- After the sale runs, ingest actual results into `SaleResult` and recompute comparables. This is the first turn of the recursive loop, even before ML.

**Data dependency:** a real Keeneland September catalog PDF + published results pages. Do **not** scrape — compile from publicly visible results manually for the MVP, and open a data-licensing conversation with Keeneland in parallel.

**Acceptance:**
- A full September catalog ingests with >95% of hips parsed, the rest logged.
- Every hip in the upcoming sale gets a value band + price band + confidence.
- A buyer can filter to "value horses under $X" and get a ranked list in under a second.
- Re-ingesting the catalog produces zero duplicate hips/horses.

**Timeline:** 10–14 weeks to a working internal prototype.

---

## Phase 2 — Real Model + Recursive Loop

Replace comparables with a trained model and close the learning loop properly.

### 2a. LightGBM regression (`services/ml/app/valuation`)
- Train on `log(price)` over engineered tabular features: encoded sire / damsire, sire-level stats (avg yearling price last 3yr, earnings per starter, stakes-winner %, stud-fee trajectory), dam produce record, consignor historical average, sale session, hip position, year trend.
- Output prediction intervals (quantile models or conformal prediction) → these become the price band and feed `confidence`.
- `limitedComparables = true` when the hip's pedigree/sire has too few training comparables (e.g., first-crop sires). Surface it; never paper over it.

### 2b. Hidden-gem score (`Valuation.hiddenGemScore`)
- `(estimated value mid) − (predicted price mid)`, normalized. Horses the model values above what it expects them to sell for. This is the killer feature — undervalued hips before bidding starts.
- Add a "hidden gems only" filter to search (`SearchQuery.hiddenGemsOnly` is already in the schema).

### 2c. SireStats pipeline
- Compile sire-level stats annually (BloodHorse / TDN publish these) into `SireStats`. Manual at first; structured ingestion later.

### 2d. Automated retrain job (`apps/api/src/jobs` + Redis/BullMQ)
- Scheduled job: after each sale's results land, append to training data, retrain, version the model (`modelVersion`), and snapshot eval metrics.
- Track prediction error by segment (by sire, consignor, session). This tells you exactly where the model is weak and where to focus next.
- Model registry: keep old versions; never overwrite. Valuations record which `modelVersion` produced them.

### 2e. Surface improvement to users
- "Our model has processed X sales and Y results — here's how accuracy has improved." Make the recursive loop visible; it's the differentiator.

**Acceptance:**
- LightGBM beats the Phase 1 comparables baseline on held-out sales (lower median absolute error on `log(price)`).
- Retrain runs end to end automatically after a results ingest and bumps `modelVersion`.
- Error-by-segment dashboard exists and is reviewed each cycle.

---

## Phase 3 — Buyer Layer

Make it a tool a buyer lives in across a sale, not just a one-shot search.

- **Buyer profiles** (`BuyerProfile`): budget, preferred bloodlines/sires, geographic trainer/farm preference, outcross patterns, race-now vs. develop. Pre-filter a 3,000-hip catalog down to a top 50.
- **Shortlists + notes** (`Shortlist` / `ShortlistItem`): work through the catalog, save candidates, attach private notes per hip.
- **Auction calendar aggregation**: maintain a calendar of all major sales for the year (Keeneland Jan/April/Sept, Fasig-Tipton July/Saratoga, OBS, Tattersalls, Goffs, Inglis). Show what's upcoming and when catalogs drop.
- **Alerts** (Redis-backed): catalog-drop alerts, "hips matching your criteria just appeared," "sale is 48 hours out." Email/SMS.
- **Auth**: real `User` accounts (email-based to start). Privacy review on stored buyer behavior.

**Acceptance:** a buyer creates a profile, gets an auto-filtered shortlist for an upcoming sale, saves hips with notes, and receives a catalog-drop alert.

---

## Phase 4 — Expansion

Broaden data and buyer pool once the loop is proven on Keeneland.

- **Fasig-Tipton** (July Selected Yearling + Saratoga): second US house → genuine cross-auction comparison. Add to `AuctionHouse` ingestion + parser templates.
- **Tattersalls (October Book 1/2/3) + Goffs**: UK/Irish market; opens European buyers. New parser templates, currency handling (still cents, per-currency).
- **Horses in training** as a new hip type: requires racing performance data (speed figures, class ratings) — license Timeform (UK/IRE) or Equibase (US). Harder model, larger buyer pool.
- **Broodmares** as a third type: features = own race record, produce record (how foals sold and ran), age, sire of mare.

**Acceptance:** a buyer compares value across Keeneland and Fasig-Tipton in one view; at least one non-yearling type (training or broodmare) has a working valuation path.

---

## Phase 5 — Productionize & Position

- **Railway deploy** (matches your stack): web, api, ML service, Postgres, Redis. CI on push, migrations gated.
- **Monetization decision:** direct-to-buyer subscription vs. B2B tool sold to bloodstock agents (sidesteps the "buyers trust their agent, not an app" ceiling). Trident flagged B2B as the likely better wedge — revisit with real usage data.
- **Legal hardening:** terms of service, explicit "informational only, scores pedigree + comparables not physical/vet condition" disclaimers, and E&O insurance if you go professional-services. Talk to a lawyer before charging.
- **Data agreements:** convert the licensing conversations from Phase 1 into signed agreements. This is the actual moat — the model is replicable, a Keeneland/Fasig-Tipton data relationship is not.

---

## Load-bearing assumptions (kill criteria)

If any of these prove false, stop and reassess:

1. At least one major auction house tolerates or partners on data use. You can prototype on manual data; you cannot scale on it.
2. A real buyer segment is underserved by current agents (syndicates, new entrants, international buyers) and will trust a data tool in their decision.
3. Pedigree + market comparables are enough to be *useful* (not perfect). Bloodstock pros already use these features informally — systematizing them adds value.
4. The recursive loop improves the model rather than destabilizing it as the market shifts.
5. There's bloodstock domain credibility on the team. This market runs on trust and relationships; a pure tech team hits walls. Secure an industry co-founder or serious advisor.
