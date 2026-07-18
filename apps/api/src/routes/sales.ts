import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { prisma } from '@furlong/db';
import { revalueSale } from '../valuation/revalueSale.js';
import { valuateBroodmareSale } from '../valuation/broodmare.js';
import { valuateRacingAgeSale } from '../valuation/racingAge.js';
import { valueSaleByCategory } from '../valuation/dispatch.js';
import { computePedigreeGrade, pedigreeGradeForHip } from '../pedigreeGrade.js';
import { expertPedigreeFor } from '../data/ftJuly2026Pedigree.js';
import { scoreValuation, aggregateScores } from '@furlong/shared';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

export async function registerSaleRoutes(app: FastifyInstance) {
  // List sales. Includes hipCount so the UI can flag catalog-pending sales.
  // ?status=upcoming  → startDate in the future OR null (date not yet set)
  // ?status=past      → startDate in the past (confirmed concluded)
  // ?status=all / omitted → everything, sorted newest first
  app.get<{ Querystring: { status?: string } }>('/sales', async (req) => {
    const status = req.query.status ?? 'all';
    const now = new Date();
    const thisYear = now.getUTCFullYear();

    // A sale is CONCLUDED (→ archive) once it has actually run: any realized
    // result is loaded, OR its start date has passed. Undated sales fall back to
    // the year. Everything else is UPCOMING. This is what makes a just-finished
    // sale drop out of the home/auction views and into the archive immediately,
    // and the next sale become the default — driven by real state, not the year.
    const sales = await prisma.sale.findMany({
      include: {
        _count: { select: { hips: true } },
        // Existence probe: does any hip in this sale have a result?
        hips: { where: { result: { isNot: null } }, take: 1, select: { id: true } },
      },
    });

    const mapped = sales.map((sale) => {
      const { _count, hips: probe, ...s } = sale;
      const concluded =
        probe.length > 0
          ? true // has ≥1 realized result
          : s.startDate
            ? s.startDate.getTime() < now.getTime()
            : s.year < thisYear; // undated: fall back to the year
      return { ...s, hipCount: _count.hips, concluded };
    });

    const filtered =
      status === 'upcoming'
        ? mapped.filter((s) => !s.concluded)
        : status === 'past'
          ? mapped.filter((s) => s.concluded)
          : mapped;

    // Upcoming: soonest first (undated future sinks). Past/all: most recent first.
    const dateVal = (d: Date | null) => (d ? d.getTime() : null);
    filtered.sort((a, b) => {
      if (status === 'upcoming') {
        const ad = dateVal(a.startDate);
        const bd = dateVal(b.startDate);
        if (ad != null && bd != null) return ad - bd;
        if (ad != null) return -1;
        if (bd != null) return 1;
        return a.year - b.year;
      }
      const ad = dateVal(a.startDate);
      const bd = dateVal(b.startDate);
      if (ad != null && bd != null) return bd - ad;
      if (ad != null) return -1;
      if (bd != null) return 1;
      return b.year - a.year;
    });

    return filtered;
  });

  // Hips for a sale, with horse + latest valuation + pedigree grade.
  app.get<{ Params: { id: string } }>('/sales/:id/hips', async (req) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      select: { auctionHouse: true, name: true, year: true },
    });
    const hips = await prisma.hip.findMany({
      where: { saleId: req.params.id },
      include: {
        horse: { include: { sire: true, dam: { include: { sire: true } } } },
        consignor: true,
        breeder: true,
        result: true,
        valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { hipNumber: 'asc' },
    });
    return hips.map((h) => {
      const expert = sale
        ? expertPedigreeFor({
            auctionHouse: sale.auctionHouse,
            saleName: sale.name,
            year: sale.year,
            hipNumber: h.hipNumber,
            sireName: h.horse.sire?.name ?? null,
          })
        : null;
      return {
        ...h,
        // DB barn, falling back to the per-sale expert dataset.
        barn: h.barn ?? expert?.barn ?? null,
        pedigreeGrade: sale
          ? pedigreeGradeForHip({
              auctionHouse: sale.auctionHouse,
              saleName: sale.name,
              year: sale.year,
              hipNumber: h.hipNumber,
              sireName: h.horse.sire?.name ?? null,
              catalogPageText: h.catalogPageText,
            })
          : computePedigreeGrade(h.catalogPageText),
      };
    });
  });

  // Score the model's predictions for a sale against its realized results.
  // Once a completed sale's results are loaded (POST /ingest/results), this
  // compares each sold hip's actual hammer price to its latest predicted band.
  // Returns null scorecard when no sold hip has a valuation to score against.
  app.get<{ Params: { id: string } }>('/sales/:id/scorecard', async (req) => {
    const hips = await prisma.hip.findMany({
      where: { saleId: req.params.id },
      include: {
        result: true,
        valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { hipNumber: 'asc' },
    });

    const nSold = hips.filter((h) => h.result && !h.result.rna && h.result.priceCents != null).length;

    const scored = hips.flatMap((h) => {
      const price = h.result && !h.result.rna ? h.result.priceCents : null;
      const v = h.valuations[0];
      if (price == null || !v) return [];
      const s = scoreValuation(price, v);
      if (!s) return [];
      return [
        {
          hipNumber: h.hipNumber,
          actualCents: s.actualCents,
          predMidCents: s.predMidCents,
          withinPredBand: s.withinPredBand,
          predDeltaPct: s.predDeltaPct,
          predAbsPctError: s.predAbsPctError,
          predErrorFactor: s.predErrorFactor,
          withinEstBand: s.withinEstBand,
        },
      ];
    });

    const scorecard = aggregateScores(
      scored.map((s) => ({
        actualCents: s.actualCents,
        predMidCents: s.predMidCents,
        withinPredBand: s.withinPredBand,
        predDeltaPct: s.predDeltaPct,
        predAbsPctError: s.predAbsPctError,
        predErrorFactor: s.predErrorFactor,
        estMidCents: 0,
        withinEstBand: s.withinEstBand,
      })),
    );

    return { nSold, nScored: scored.length, scorecard, scored };
  });

  // Model track record — scorecards for every completed sale that has both
  // predictions and realized results, plus a pooled overall. Cached briefly
  // (scoring scans a lot of hips). Only sales from the model's out-of-sample
  // years (>= 2024) with a catalog are considered.
  let trackCache: { at: number; body: unknown } | null = null;
  app.get('/scorecards', async () => {
    const now = Date.now();
    if (trackCache && now - trackCache.at < 10 * 60_000) return trackCache.body;

    const sales = await prisma.sale.findMany({
      where: { year: { gte: 2024 }, hips: { some: {} } },
      select: { id: true, auctionHouse: true, name: true, year: true, currency: true },
    });

    const perSale: unknown[] = [];
    const allScores: ReturnType<typeof scoreValuation>[] = [];
    for (const s of sales) {
      const hips = await prisma.hip.findMany({
        where: { saleId: s.id },
        select: {
          result: { select: { priceCents: true, rna: true } },
          valuations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              estValueLowCents: true,
              estValueHighCents: true,
              predPriceLowCents: true,
              predPriceHighCents: true,
            },
          },
        },
      });
      let nSold = 0;
      const scores = [];
      for (const h of hips) {
        const price = h.result && !h.result.rna ? h.result.priceCents : null;
        if (price != null) nSold += 1;
        const v = h.valuations[0];
        if (price == null || !v) continue;
        const sc = scoreValuation(price, v);
        if (sc) {
          scores.push(sc);
          allScores.push(sc);
        }
      }
      const scorecard = aggregateScores(scores);
      if (scorecard) {
        perSale.push({
          saleId: s.id,
          auctionHouse: s.auctionHouse,
          name: s.name,
          year: s.year,
          nSold,
          nScored: scores.length,
          scorecard,
        });
      }
    }

    perSale.sort((a, b) => {
      const A = a as { year: number; auctionHouse: string };
      const B = b as { year: number; auctionHouse: string };
      return B.year - A.year || A.auctionHouse.localeCompare(B.auctionHouse);
    });

    const overall = aggregateScores(allScores.filter((s): s is NonNullable<typeof s> => s != null));
    const body = { overall, sales: perSale };
    trackCache = { at: now, body };
    return body;
  });

  // Mark a hip as withdrawn (pulled from the sale before it rings).
  app.post<{ Params: { hipId: string } }>('/hips/:hipId/withdraw', async (req, reply) => {
    const hip = await prisma.hip.update({
      where: { id: req.params.hipId },
      data: { withdrawn: true },
      select: { id: true, hipNumber: true, withdrawn: true },
    });
    return hip;
  });

  // Reinstate a previously withdrawn hip.
  app.post<{ Params: { hipId: string } }>('/hips/:hipId/reinstate', async (req, reply) => {
    const hip = await prisma.hip.update({
      where: { id: req.params.hipId },
      data: { withdrawn: false },
      select: { id: true, hipNumber: true, withdrawn: true },
    });
    return hip;
  });

  // Capture each hip's black-type catalog page from the sale's catalog PDF (via
  // the ML service) into Hip.catalogPageText — so pedigree grades compute. Used
  // by the ingest pipeline for FT sales, and callable for backfill.
  app.post<{ Params: { id: string }; Body: { pdfUrl?: string } }>(
    '/sales/:id/catalog-pages',
    async (req, reply) => {
      const pdfUrl = req.body?.pdfUrl;
      if (!pdfUrl) return reply.status(400).send({ error: 'pdfUrl is required' });
      const res = await request(`${ML_SERVICE_URL}/catalog-pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ saleId: req.params.id, pdfUrl }),
        headersTimeout: 300_000,
        bodyTimeout: 300_000,
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const text = await res.body.text();
        return reply
          .status(502)
          .send({ error: `ML /catalog-pages failed: ${res.statusCode} ${text.slice(0, 200)}` });
      }
      return res.body.json();
    },
  );

  // 1d — Re-value all hips in a sale via the ML service.
  app.post<{ Params: { id: string } }>('/sales/:id/revalue', async (req) => {
    return revalueSale(req.params.id);
  });

  // 4 — Value broodmares in a BREEDING_STOCK sale by produce record.
  app.post<{ Params: { id: string } }>('/sales/:id/value-broodmares', async (req) => {
    return valuateBroodmareSale(req.params.id);
  });

  // 4 — Value horses-in-training / 2YOs by sire comparables + racing record.
  app.post<{ Params: { id: string } }>('/sales/:id/value-racing-age', async (req) => {
    return valuateRacingAgeSale(req.params.id);
  });

  // 4 — Value a sale via the right path for its category (yearling model /
  // broodmare produce / racing-age). What the automated pipeline uses.
  app.post<{ Params: { id: string } }>('/sales/:id/value', async (req) => {
    return valueSaleByCategory(req.params.id);
  });

  // 1f — Post-sale retrain seed: tell the ML service to reload comparables
  // (newly imported results), then re-value the sale against the fresh model.
  app.post<{ Params: { id: string } }>('/sales/:id/retrain-seed', async (req, reply) => {
    const res = await request(`${ML_SERVICE_URL}/reload-comparables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      return reply
        .status(502)
        .send({ error: `ML /reload-comparables failed: ${res.statusCode} ${text}` });
    }
    // ML /reload-comparables returns { comparables: <count> }.
    const json = (await res.body.json()) as { comparables?: number };
    const reloaded = json.comparables ?? 0;

    const { valued } = await revalueSale(req.params.id);
    return { reloaded, valued };
  });
}
