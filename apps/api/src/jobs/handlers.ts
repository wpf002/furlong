/**
 * Job handlers — plain async functions, queue-agnostic.
 *
 * The BullMQ worker and the manual /jobs/* endpoints both call these, so the
 * pipeline is fully exercisable without Redis. Network calls to auction-house
 * sources are gated by DISCOVERY_ENABLED inside the handlers themselves, so the
 * licensing invariant holds no matter who invokes them.
 */
import { request } from 'undici';
import { prisma } from '@furlong/db';
import { valueSaleByCategory } from '../valuation/dispatch.js';
import {
  createCriteriaMatchAlerts,
  createSaleSoonAlerts,
} from '../alerts.js';
import { jobsConfig, type IngestSaleJobData } from './config.js';
import { sourceAdapters, getAdapter } from './sources/index.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export interface DiscoverSummary {
  enabled: boolean;
  source: string;
  seen: number;
  newSales: IngestSaleJobData[];
}

export interface IngestSaleSummary {
  source: string;
  saleName: string;
  year: number;
  saleId: string | null;
  hips: number;
  resultsImported: number;
  valued: number;
  criteriaAlerts: number;
  skipped?: string;
}

/**
 * Discover newly-advertised sales across all registered adapters. For each sale
 * the source exposes we upsert a calendar shell (so upcoming sales appear even
 * before their catalog is fetched) and, if we hold no hips for it yet, hand it
 * to `onCandidate` for ingestion. Returns one summary per source.
 */
export async function runDiscover(
  onCandidate: (d: IngestSaleJobData) => Promise<void>,
): Promise<DiscoverSummary[]> {
  if (!jobsConfig.discoveryEnabled) {
    return sourceAdapters.map((a) => ({
      enabled: false,
      source: a.key,
      seen: 0,
      newSales: [],
    }));
  }

  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear + 1];
  const summaries: DiscoverSummary[] = [];

  for (const adapter of sourceAdapters) {
    let discovered: Awaited<ReturnType<typeof adapter.discoverSales>> = [];
    try {
      discovered = await adapter.discoverSales(years);
    } catch (err) {
      summaries.push({ enabled: true, source: adapter.key, seen: 0, newSales: [] });
      void err;
      continue;
    }

    const newSales: IngestSaleJobData[] = [];
    for (const d of discovered) {
      // Upsert the calendar shell. Only sets dates; never clobbers an existing
      // catalog (hips/results are managed by the ingest job).
      const sale = await prisma.sale.upsert({
        where: {
          auctionHouse_name_year: {
            auctionHouse: d.source as never,
            name: d.saleName,
            year: d.year,
          },
        },
        update: {
          ...(d.startDate ? { startDate: new Date(d.startDate) } : {}),
          ...(d.endDate ? { endDate: new Date(d.endDate) } : {}),
        },
        create: {
          auctionHouse: d.source as never,
          name: d.saleName,
          year: d.year,
          currency: d.currency,
          category: d.category as never,
          startDate: d.startDate ? new Date(d.startDate) : null,
          endDate: d.endDate ? new Date(d.endDate) : null,
        },
        select: { id: true },
      });

      const hipCount = await prisma.hip.count({ where: { saleId: sale.id } });
      if (hipCount === 0) {
        const job: IngestSaleJobData = {
          source: d.source,
          code: d.code,
          saleName: d.saleName,
          year: d.year,
        };
        newSales.push(job);
        await onCandidate(job);
      }
    }
    summaries.push({ enabled: true, source: adapter.key, seen: discovered.length, newSales });
  }
  return summaries;
}

/**
 * Fetch one sale's catalog + results from its source and ingest both, then
 * value the sale and raise criteria-match alerts. Reuses the HTTP ingest
 * endpoints so entity resolution + catalog-drop alerts run identically to a
 * manual ingest.
 */
export async function runIngestSale(data: IngestSaleJobData): Promise<IngestSaleSummary> {
  const base: IngestSaleSummary = {
    source: data.source,
    saleName: data.saleName,
    year: data.year,
    saleId: null,
    hips: 0,
    resultsImported: 0,
    valued: 0,
    criteriaAlerts: 0,
  };

  if (!jobsConfig.discoveryEnabled) {
    return { ...base, skipped: 'DISCOVERY_ENABLED is not set' };
  }
  const adapter = getAdapter(data.source);
  if (!adapter) return { ...base, skipped: `no adapter for ${data.source}` };

  const fetched = await adapter.fetchSale(data.code);
  if (!fetched) return { ...base, skipped: 'source returned no horses' };

  // 1) Catalog (pedigree + entity resolution + catalog-drop alerts).
  const n = fetched.hips.length;
  const catalogBody = {
    auctionHouse: fetched.auctionHouse,
    saleName: fetched.saleName,
    year: fetched.year,
    currency: fetched.currency,
    category: fetched.category,
    hips: fetched.hips,
    report: {
      pagesScanned: n,
      blocksDetected: n,
      hipsParsed: n,
      hipsSkipped: 0,
      parseRate: n ? 1.0 : 0.0,
      skipped: [],
    },
  };
  const cRes = await request(`${jobsConfig.selfUrl}/ingest/catalog-json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(catalogBody),
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
  });
  if (cRes.statusCode < 200 || cRes.statusCode >= 300) {
    const t = await cRes.body.text();
    return { ...base, skipped: `catalog ingest failed: ${cRes.statusCode} ${t.slice(0, 200)}` };
  }
  const cJson = (await cRes.body.json()) as { saleId: string };
  const saleId = cJson.saleId;

  // 2) Results (price / RNA / buyer).
  const form = new FormData();
  form.append('saleId', saleId);
  form.append('file', new Blob([fetched.resultsCsv], { type: 'text/csv' }), 'results.csv');
  const rRes = await request(`${jobsConfig.selfUrl}/ingest/results`, {
    method: 'POST',
    body: form,
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
  });
  let resultsImported = 0;
  if (rRes.statusCode >= 200 && rRes.statusCode < 300) {
    const rJson = (await rRes.body.json()) as { imported?: number };
    resultsImported = rJson.imported ?? 0;
  }

  // 3) Value the sale (right path for its category), then raise criteria-match
  // alerts (needs valuations).
  const { valued } = await valueSaleByCategory(saleId);
  const criteriaAlerts = await createCriteriaMatchAlerts(saleId);

  return {
    ...base,
    saleId,
    hips: n,
    resultsImported,
    valued,
    criteriaAlerts,
  };
}

export interface RetrainSummary {
  modelVersion?: string;
  metrics?: unknown;
  valuedSales: number;
  valuedHips: number;
}

/**
 * Retrain the model on all current results (versions + registers it), then
 * re-value upcoming sales so fresh predictions reach buyers. This is the
 * automated turn of the recursive loop (ROADMAP 2d).
 */
export async function runRetrain(saleId?: string): Promise<RetrainSummary> {
  const res = await request(`${ML_SERVICE_URL}/train`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const t = await res.body.text();
    throw new Error(`ML /train failed: ${res.statusCode} ${t.slice(0, 200)}`);
  }
  const trained = (await res.body.json()) as { modelVersion?: string; metrics?: unknown };

  // Re-value: the named sale, or every upcoming sale (startDate in the future or
  // unknown) so the catalogs buyers are actively working refresh under the new
  // model. Settled history is left as-is (its prices are facts, not predictions).
  let valuedSales = 0;
  let valuedHips = 0;
  if (saleId) {
    valuedHips += (await valueSaleByCategory(saleId)).valued;
    valuedSales += 1;
  } else {
    const now = new Date();
    const upcoming = await prisma.sale.findMany({
      where: { OR: [{ startDate: null }, { startDate: { gte: now } }] },
      select: { id: true },
    });
    for (const s of upcoming) {
      valuedHips += (await valueSaleByCategory(s.id)).valued;
      valuedSales += 1;
    }
  }

  return {
    modelVersion: trained.modelVersion,
    metrics: trained.metrics,
    valuedSales,
    valuedHips,
  };
}

export async function runSaleSoon(): Promise<{ created: number; windowHours: number }> {
  const created = await createSaleSoonAlerts(jobsConfig.saleSoonWindowHours);
  return { created, windowHours: jobsConfig.saleSoonWindowHours };
}
