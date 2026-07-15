#!/usr/bin/env node
/**
 * Load a completed sale's results and score the model's predictions against them.
 *
 * Posts a results CSV to the API's POST /ingest/results endpoint (which upserts
 * each hip's realized hammer price), then fetches GET /sales/:id/scorecard and
 * prints how the predictions actually did.
 *
 * Usage:
 *   node scripts/load-sale-results.mjs --sale <saleId> --csv <path> [--api <baseUrl>]
 *
 *   --sale   Sale id to attach results to (from GET /sales).
 *   --csv    Path to the results CSV.
 *   --api    API base URL. Defaults to $FURLONG_API_URL or http://localhost:4100.
 *
 * CSV columns (header row required; extra columns ignored):
 *   hipNumber   required — the catalog hip number
 *   price       sale price in dollars (e.g. 185000)     ┐ provide one of
 *   priceCents  sale price in integer cents             ┘ price / priceCents
 *   rna         "true" if the hip did not meet reserve (no price)
 *   buyer       optional buyer name
 *   soldAt      optional ISO date/time
 *
 * Example row:  hipNumber,price,rna,buyer
 *               42,185000,false,Godolphin
 */
import { readFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const saleId = arg('sale');
const csvPath = arg('csv');
const apiBase = (arg('api', process.env.FURLONG_API_URL) ?? 'http://localhost:4100').replace(/\/$/, '');

if (!saleId || !csvPath) {
  console.error('Usage: node scripts/load-sale-results.mjs --sale <saleId> --csv <path> [--api <baseUrl>]');
  process.exit(1);
}

const csv = readFileSync(csvPath, 'utf-8');

const fmt = (cents) =>
  cents == null ? '—' : `$${Math.round(Number(cents) / 100).toLocaleString('en-US')}`;
const pct = (x) => `${Math.round(x * 100)}%`;

async function main() {
  // 1) Upload the results CSV.
  const form = new FormData();
  form.append('saleId', saleId);
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'results.csv');

  const up = await fetch(`${apiBase}/ingest/results`, { method: 'POST', body: form });
  if (!up.ok) {
    console.error(`Upload failed: ${up.status} ${await up.text()}`);
    process.exit(1);
  }
  const upJson = await up.json();
  console.log(`Imported ${upJson.imported} result rows.`);
  if (Array.isArray(upJson.skipped) && upJson.skipped.length) {
    console.log(`Skipped ${upJson.skipped.length}:`);
    for (const s of upJson.skipped.slice(0, 20)) console.log(`  hip ${s.hipNumber ?? '?'}: ${s.reason}`);
  }

  // 2) Score predictions against the freshly-loaded results.
  const scRes = await fetch(`${apiBase}/sales/${encodeURIComponent(saleId)}/scorecard`);
  if (!scRes.ok) {
    console.error(`Scorecard failed: ${scRes.status} ${await scRes.text()}`);
    process.exit(1);
  }
  const { nSold, nScored, scorecard, scored } = await scRes.json();

  console.log(`\nSold: ${nSold}   Scored against a prediction: ${nScored}`);
  if (!scorecard) {
    console.log('No hips could be scored yet (need both a realized price and a valuation).');
    console.log('If the sale was valued after results loaded, re-run POST /sales/:id/value first.');
    return;
  }
  console.log('\n── Scorecard ──────────────────────────────');
  console.log(`  Landed in estimate : ${pct(scorecard.pctWithinPredBand)} of ${scorecard.n}`);
  console.log(`  Median miss        : ${pct(scorecard.medianAbsPctError)}`);
  console.log(`  Typical error      : ${scorecard.medianErrorFactor.toFixed(2)}×`);
  console.log(
    `  Market vs. us      : ${scorecard.medianDeltaPct >= 0 ? '+' : ''}${pct(scorecard.medianDeltaPct)} (median)`,
  );

  const worst = [...scored].sort((a, b) => b.predAbsPctError - a.predAbsPctError).slice(0, 5);
  if (worst.length) {
    console.log('\n  Biggest misses:');
    for (const s of worst) {
      console.log(
        `    hip ${s.hipNumber}: sold ${fmt(s.actualCents)} vs est ${fmt(s.predMidCents)} ` +
          `(${s.predDeltaPct >= 0 ? '+' : ''}${pct(s.predDeltaPct)})`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
