# Data-feed procurement brief

Furlong's valuation model is at the ceiling of what pedigree + sale context can
predict (see [can-the-ai-choose.md](can-the-ai-choose.md)). The one lever left is
external data. The engineering rails are already built — `SireStats` +
`POST /ingest/sire-stats` + leakage-safe features (`sire_studfee_log`,
`sire_eps_log`, `sire_swpct`). This brief is what turns a signed feed into a
measured model lift.

**ROADMAP invariant: license the data, do not scrape.** Equibase in particular
sends cease-and-desist orders for automated aggregation of even public data.

## Two feeds, in priority order

### Phase 1 (start here): sire-level statistics
Directly populates the features already wired in; smallest/cheapest license;
fastest path to measurable lift. It's the highest leverage because ~34% of a
typical catalog is by first-crop sires with no sales history — exactly where
stud fee and progeny stats add signal we don't otherwise have.

- **Primary vendor: The Jockey Club Information Systems (JCIS) / equineline.com.**
  This is the authoritative source — BloodHorse's published sire lists (progeny
  earnings, first-crop sires, 2YO sires, AEI) are *supplied by JCIS*. JCIS sells
  custom reports and data access from their worldwide database. Contact via
  equineline.com / jockeyclub.com (Jockey Club Information Systems).
- **What to request** (per sire, per year, with HISTORY — see "leakage" below):
  stud fee, progeny earnings, **earnings per starter**, **stakes-winner %**,
  starters/runners counts, and AEI if available.

### Phase 2 (later): race results at scale
Bigger, license-heavier. Lets us compute sire progeny-quality ourselves and
powers the horses-in-training valuation. Not needed to light up Phase 1.

- **Equibase (US)** — no public developer API; licensed data partnerships only.
  Note the aggressive anti-scraping posture. There is a free eval dataset
  (single season) we already parse (`services/ml/scripts/parse_equibase*.py`) —
  production needs the licensed feed.
- **Timeform (UK/IRE)** — REST API via Betfair (`api.timeform.com`,
  `commercial@timeform.com`); historical data available to subscribers.

## The data contract (Phase 1 → our ingest)

A vendor file (CSV or JSON) maps to `POST /ingest/sire-stats`. One row per
`(sire, year)`. Field mapping:

| Our field (`/ingest/sire-stats`) | Meaning | Vendor source |
|---|---|---|
| `sireName` (required) | sire name; matched to our `Horse.normalizedName` | stallion name |
| `year` (required) | the statistic's year | reporting year |
| `studFeeCents` | advertised stud fee, in cents | stud fee (× 100) |
| `earningsPerStarterCents` | progeny earnings / starter, in cents | earnings ÷ starters (× 100) |
| `stakesWinnerPct` | stakes winners / starters, as a 0–1 fraction | SW% ÷ 100 |
| `avgYearlingCents` | mean progeny yearling price, in cents | avg yearling (× 100) |

### Two requirements that make or break the feed

1. **History, not a snapshot.** We read each sire's stats *as-of a strictly
   earlier year* than the sale (leakage-safe). A single current-year dump is
   nearly useless for training — we need one row per sire **per past year**
   (target: 2010→present to match our sales archive). Ask explicitly for the
   historical back-file.
2. **Stable sire identity.** Name-matching works but collides (e.g. two horses
   named "Olympiad"). If the vendor can supply a stable registration ID (Jockey
   Club / equineline ID), request it — we'd add it as a match key to eliminate
   ambiguity.

## How to evaluate a trial dataset (before you pay for the full feed)

Ask any vendor for a **sample/trial file** first. Then:

1. **Coverage** — `services/ml/scripts/evaluate_sire_stats_feed.py <file.csv>`
   reports how many of our sires the feed matches and, crucially, its coverage of
   **first-crop sires in the live catalog** (the horses we price worst). A feed
   that only covers established sires adds little; one that reaches first-crop
   sires is the prize.
2. **Lift** — load the trial (`--commit`), retrain, then
   `services/ml/scripts/measure_sire_feature_lift.py` reports the change in
   holdout error with vs without the sire features. That delta is the ROI number
   that justifies the license spend.

## Bottom line

Start the conversation with **Jockey Club Information Systems** for a historical
sire-stats back-file (stud fee + earnings-per-starter + stakes-winner %, per sire
per year, 2010→present). Get a sample, run the two scripts, and let the measured
lift decide. Everything downstream is built.
