import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { prisma } from '@furlong/db';
import { ParseCatalogResponseSchema, numberToCents } from '@furlong/shared';
import { ingestCatalog } from '../ingest/ingestCatalog.js';
import { parseCsv } from '../ingest/csv.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

const AUCTION_HOUSES = [
  'KEENELAND',
  'FASIG_TIPTON',
  'TATTERSALLS',
  'GOFFS',
  'OBS',
  'INGLIS',
] as const;
type AuctionHouse = (typeof AUCTION_HOUSES)[number];

interface ResultsSkip {
  hipNumber: number | null;
  reason: string;
}

export async function registerIngestRoutes(app: FastifyInstance) {
  // 1b — Parse a catalog PDF via the ML service and ingest it.
  // The sale's identity (auction house / sale name / year) is NOT printed on
  // the hip pages, so it can be supplied as override form fields alongside the
  // file: `auctionHouse`, `saleName`, `year`.
  app.post('/ingest/catalog', async (req, reply) => {
    let buffer: Buffer | undefined;
    let filename = 'catalog.pdf';
    let mimetype = 'application/pdf';
    const overrides: { auctionHouse?: AuctionHouse; saleName?: string; year?: number } = {};

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        buffer = await part.toBuffer();
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
      } else if (part.fieldname === 'auctionHouse') {
        const v = String(part.value).toUpperCase();
        if ((AUCTION_HOUSES as readonly string[]).includes(v)) {
          overrides.auctionHouse = v as AuctionHouse;
        } else {
          return reply
            .status(400)
            .send({ error: `auctionHouse must be one of ${AUCTION_HOUSES.join(', ')}` });
        }
      } else if (part.fieldname === 'saleName') {
        overrides.saleName = String(part.value);
      } else if (part.fieldname === 'year') {
        const y = parseInt(String(part.value), 10);
        if (Number.isInteger(y)) overrides.year = y;
      }
    }

    if (!buffer) {
      return reply.status(400).send({ error: 'multipart PDF file is required' });
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mimetype }),
      filename,
    );

    const res = await request(`${ML_SERVICE_URL}/parse-catalog`, {
      method: 'POST',
      body: form,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      return reply
        .status(502)
        .send({ error: `ML /parse-catalog failed: ${res.statusCode} ${text}` });
    }

    const json = await res.body.json();
    const parsed = ParseCatalogResponseSchema.parse(json);

    // Apply sale-identity overrides (the catalog pages don't carry them).
    if (overrides.auctionHouse) parsed.auctionHouse = overrides.auctionHouse;
    if (overrides.saleName) parsed.saleName = overrides.saleName;
    if (overrides.year !== undefined) parsed.year = overrides.year;

    const { saleId, created, updated } = await ingestCatalog(parsed);

    return {
      saleId,
      created,
      updated,
      parseRate: parsed.report.parseRate,
      hipsParsed: parsed.report.hipsParsed,
      hipsSkipped: parsed.report.hipsSkipped,
    };
  });

  // 1b (JSON variant) — Ingest an already-parsed catalog (e.g. sourced from an
  // auction-house data API rather than a PDF). Same entity resolution + upsert.
  app.post('/ingest/catalog-json', async (req, reply) => {
    const parsed = ParseCatalogResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { saleId, created, updated } = await ingestCatalog(parsed.data);
    return {
      saleId,
      created,
      updated,
      parseRate: parsed.data.report.parseRate,
      hipsParsed: parsed.data.report.hipsParsed,
      hipsSkipped: parsed.data.report.hipsSkipped,
    };
  });

  // 1c — Import historical sale results from a CSV.
  app.post('/ingest/results', async (req, reply) => {
    let saleId: string | undefined;
    let csvText: string | undefined;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        csvText = (await part.toBuffer()).toString('utf-8');
      } else if (part.fieldname === 'saleId') {
        saleId = String(part.value);
      }
    }

    if (!saleId) return reply.status(400).send({ error: 'saleId form field is required' });
    if (csvText == null) return reply.status(400).send({ error: 'CSV file is required' });

    const rows = parseCsv(csvText);
    const skipped: ResultsSkip[] = [];
    let imported = 0;

    for (const row of rows) {
      const hipNumber = parseInt(row.hipNumber ?? '', 10);
      if (!Number.isInteger(hipNumber)) {
        skipped.push({ hipNumber: null, reason: `invalid hipNumber: "${row.hipNumber ?? ''}"` });
        continue;
      }

      const hip = await prisma.hip.findUnique({
        where: { saleId_hipNumber: { saleId, hipNumber } },
        select: { id: true },
      });
      if (!hip) {
        skipped.push({ hipNumber, reason: 'hip not found for sale' });
        continue;
      }

      const rna = parseBool(row.rna);
      let priceCents: bigint | null = null;
      if (!rna) {
        if (row.priceCents != null && row.priceCents !== '') {
          const c = Number(row.priceCents);
          if (Number.isInteger(c)) priceCents = numberToCents(c);
        } else if (row.price != null && row.price !== '') {
          const dollars = Number(row.price);
          if (Number.isFinite(dollars)) priceCents = numberToCents(Math.round(dollars * 100));
        }
      }

      const buyer = row.buyer && row.buyer !== '' ? row.buyer : null;
      let soldAt: Date | null = null;
      if (row.soldAt && row.soldAt !== '') {
        const d = new Date(row.soldAt);
        if (!Number.isNaN(d.getTime())) soldAt = d;
      }

      await prisma.saleResult.upsert({
        where: { hipId: hip.id },
        update: { priceCents, rna, buyer, soldAt },
        create: { hipId: hip.id, priceCents, rna, buyer, soldAt },
      });
      imported += 1;
    }

    return { imported, skipped };
  });
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}
