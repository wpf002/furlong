# Can the AI choose winners?

**Short answer: no — and this is a property of the problem, not a bug in the model.**
On the data Furlong has, what a yearling costs and its pedigree together explain
**~1%** of how much it later earns on the track. "Pick the horse that will win"
is not learnable from catalog data, and this document is the evidence, so the
question doesn't have to be re-litigated on a hunch.

Reproduce: `cd services/ml && .venv/bin/python scripts/backtest_can_ai_choose.py`

## The question

Furlong learns from a full archive of past sales — 148k results of *how much
horses sold for*. The natural next thought is: use it to train the AI to **choose**
future purchases. But predicting a sale **price** ("what will the market pay?")
and choosing a **winner** ("will this horse be worth it?") are different problems
with different training labels. Price prediction learns from what buyers *paid*
(the cost); choosing learns from how purchases *turned out* (the payoff). The
archive is rich on cost and nearly empty on payoff.

## Method

- **Cohort:** USD yearlings sold in 2010–2022 (careers ~mature) that later got a
  racing record matched — **5,152 horses** with both a sale price and an outcome
  (starts / wins / earnings).
- **Leakage-safe signals only:** a sire's "reputation" is the mean log sale price
  of its foals sold in *strictly earlier* years. A horse never sees its own
  cohort's outcomes.
- **Outcome:** career earnings (log), plus win rate and speed figure as checks.

## Findings

### 1. Racing success is essentially unpredictable from sale data

How much of the variance in racing earnings each signal explains (R²):

| Predictor | R² |
|---|---|
| Price paid alone | 0.011 |
| Pedigree (sire reputation) alone | 0.001 |
| Price + pedigree together | **0.012** |

**~99% of a horse's racing outcome is driven by things not in the archive** —
physical development, soundness, training, racing luck, the individual animal.
(Even published bloodstock studies with cleaner outcome data land in the low
teens of percent; the qualitative conclusion is the same: the great majority is
unexplained.)

### 2. The market itself barely does better

Buyers paid a **35× price range** and got a **~2× earnings range**, with a flat
win rate — paying more does not buy a meaningfully better chance on the track:

| Value bucket | Median price | Median earnings | Won a race |
|---|---|---|---|
| Priciest vs pedigree | $250,000 | $67,323 | 72% |
| Cheapest vs pedigree | $7,000 | $34,072 | 71% |

The market prices pedigree fashion and physical looks, which correlate only
weakly with what happens on the track.

### 3. The "buy cheap = high ROI" signal is an artifact — verified

A naive earnings-per-dollar cut screams "buy cheap" (Q5 cheap ROI 4.3× vs Q1
pricey 0.27×). It is a trap, for two reasons we confirmed:

- **Survivorship.** Only ~5% of sold horses have a matched racing record, and
  coverage *rises with price*: **3.4%** of $2,500 horses vs **9.4%** of $335k
  horses. The cheap horses we see racing are survivors; the cheap busts that
  never made the track are invisible, which inflates the cheap-bucket returns.
- **The denominator.** Earnings ÷ price mechanically rewards a small price. In
  absolute dollars, expensive horses earned *more*.

A "buy cheap" strategy built on that number walks straight into the missing busts.

## What this means for the product

- **Winner-picking is not a solvable problem from catalog data.** Even a full
  racing-results license would not crack it: results tell you which sires get
  runners (useful — see below), but the 99% that decides an individual yearling's
  fate (conformation, the vet scope, the walk) is not in any catalog. This is why
  the industry pays bloodstock agents and vets, not algorithms.
- **The AI's honest role is the one the app already plays:** price transparency
  (a calibrated range for what a horse should cost) and clearly-labeled
  relative-value flags — never "this horse will win." Positioning it as a
  winner-picker is a promise the data cannot keep.

## The one results-driven feature that *is* worth building — now built

A racing-results feed can't pick winners, but it can sharpen **pricing** via an
honest **sire-quality** signal. This is now wired end-to-end (inert until a feed
populates `SireStats`), alongside the stud-fee on-ramp in
[features.py](../services/ml/app/training/features.py).

**What it measures.** A sire's *progeny racing performance* from crops that raced
in strictly earlier years: **earnings per starter** and **stakes-winner %**.
These already exist as columns on `SireStats` (`earningsPerStarter`,
`stakesWinnerPct`) and are already accepted by `POST /ingest/sire-stats` — they
are simply unpopulated.

**Why it helps pricing (not winner-picking).** Today the model's only sire signal
is `sire_prior_mean` — the sire's past yearling *prices*. That is somewhat
circular (price predicting price) and says nothing about whether those expensive
yearlings could actually run. A results-derived sire-quality feature is an
*independent* measure of sire merit. It mainly tightens price estimates for
**established sires** (where the market's premium is now grounded in real
progeny performance, not just prior prices), and pairs with **stud fee** to cover
first-crop sires that have no history at all.

**How it works (built; ≈ the stud-fee pattern).**
1. A feed populates `SireStats.earningsPerStarter` / `stakesWinnerPct` via
   `POST /ingest/sire-stats` (endpoint accepts these fields).
2. Leakage-safe features `sire_eps_log` (log earnings per starter) and
   `sire_swpct` are built in `features.py` via a per-stat as-of-strictly-earlier-
   year merge, and passed through the inference path (`revalueSale.ts` →
   `trained.py`). Each stat resolves to its own most-recent non-null prior year,
   so a sparse feed doesn't blank out siblings.
3. Until a feed lands, `SireStats` is empty → the features are all-NaN → HistGBM
   ignores them (verified inert). They light up on the first retrain after a feed.

**Honest ceiling.** This improves *pricing accuracy*, i.e. how well we match
market consensus for established sires. It does **not** move the winner-picking
result above — the 99% remains unexplained. Scope it as a pricing feature, not a
selection oracle.
