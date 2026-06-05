/**
 * Secretariat's tools — deterministic queries over Furlong's real data. The LLM
 * decides WHICH tool to call and phrases the answer; every number comes from
 * these executors, never from the model (ROADMAP: an LLM may phrase a summary,
 * it never sets a number).
 */
import { prisma } from '@furlong/db';
import { normalizeEntityName, formatMoney } from '@furlong/shared';
import { lookupHelp } from './help.js';

const n = (v: bigint | number | null | undefined): number | null =>
  v == null ? null : Number(v);

export const TOOLS = [
  {
    name: 'list_sales',
    description:
      'List sales in the catalog. Use to answer "which sales do I have", or to find a sale id to scope a hip search. Optionally filter by category, year, or auction house.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['YEARLING', 'BREEDING_STOCK', 'TWO_YEAR_OLD', 'WEANLING', 'MIXED', 'OTHER'],
        },
        year: { type: 'integer' },
        house: {
          type: 'string',
          enum: ['KEENELAND', 'FASIG_TIPTON', 'TATTERSALLS', 'GOFFS', 'OBS', 'INGLIS'],
        },
      },
    },
  },
  {
    name: 'search_hips',
    description:
      'Search hips across all sales (or one sale via saleId). Filter by sire, dam, consignor, sex, budget (cents), hidden-gems-only, or sold-only. Use for questions like "find all horses by Into Mischief" or "colts consigned by Taylor Made under $200k".',
    input_schema: {
      type: 'object',
      properties: {
        sireName: { type: 'string' },
        damName: { type: 'string' },
        consignorName: { type: 'string' },
        sex: { type: 'string', enum: ['COLT', 'FILLY', 'GELDING', 'MARE', 'STALLION'] },
        saleId: { type: 'string', description: 'Scope to one sale (from list_sales).' },
        minPriceCents: { type: 'integer' },
        maxPriceCents: { type: 'integer' },
        hiddenGemsOnly: { type: 'boolean' },
        soldOnly: { type: 'boolean', description: 'Only hips that have already sold.' },
        limit: { type: 'integer', description: 'Max rows to return (default 25, max 50).' },
      },
    },
  },
  {
    name: 'compare_sire',
    description:
      "Break a sire's sold-yearling prices down by auction house and currency (median, average, count). Use for 'how do X's yearlings sell' or cross-house comparisons.",
    input_schema: {
      type: 'object',
      properties: { sireName: { type: 'string' } },
      required: ['sireName'],
    },
  },
  {
    name: 'app_help',
    description:
      'Explain how a Furlong feature works (shortlists, alerts, valuation, hidden gems, compare, breeze, calendar, profile, search). Use for "how do shortlists work" style questions.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string' } },
      required: ['topic'],
    },
  },
] as const;

export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_sales':
      return listSales(input);
    case 'search_hips':
      return searchHips(input);
    case 'compare_sire':
      return compareSire(input);
    case 'app_help':
      return { answer: lookupHelp(String(input.topic ?? '')) };
    default:
      return { error: `unknown tool ${name}` };
  }
}

async function listSales(input: Record<string, unknown>) {
  const where: Record<string, unknown> = {};
  if (input.category) where.category = String(input.category).toUpperCase();
  if (input.year) where.year = Number(input.year);
  if (input.house) where.auctionHouse = String(input.house).toUpperCase();
  const sales = await prisma.sale.findMany({
    where,
    orderBy: [{ year: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { hips: true } } },
  });
  return {
    count: sales.length,
    sales: sales.slice(0, 80).map((s) => ({
      id: s.id,
      house: s.auctionHouse,
      name: s.name,
      year: s.year,
      category: s.category,
      currency: s.currency,
      hips: s._count.hips,
    })),
  };
}

async function searchHips(input: Record<string, unknown>) {
  const where: Record<string, unknown> = {};
  if (input.saleId) where.saleId = String(input.saleId);
  const horse: Record<string, unknown> = {};
  if (input.sex) horse.sex = String(input.sex).toUpperCase();
  const sireNorm = normalizeEntityName(input.sireName ? String(input.sireName) : null);
  if (sireNorm) horse.sire = { normalizedName: sireNorm };
  const damNorm = normalizeEntityName(input.damName ? String(input.damName) : null);
  if (damNorm) horse.dam = { normalizedName: damNorm };
  if (Object.keys(horse).length) where.horse = horse;
  // Consignors carry agency suffixes ("Taylor Made Sales Agency"), so match on a
  // normalized substring rather than exact.
  const consNorm = normalizeEntityName(input.consignorName ? String(input.consignorName) : null);
  if (consNorm) where.consignor = { normalizedName: { contains: consNorm } };

  const rows = await prisma.hip.findMany({
    where,
    take: 600,
    include: {
      horse: { include: { sire: true, dam: true } },
      consignor: true,
      sale: true,
      result: true,
      valuations: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: [{ saleId: 'asc' }, { hipNumber: 'asc' }],
  });

  let out = rows;
  if (input.hiddenGemsOnly) {
    out = out.filter((h) => {
      const v = h.valuations[0];
      return v && v.hiddenGemScore != null && v.hiddenGemScore > 0;
    });
  }
  if (input.soldOnly) {
    out = out.filter((h) => h.result && !h.result.rna && h.result.priceCents != null);
  }
  const maxC = input.maxPriceCents != null ? Number(input.maxPriceCents) : null;
  const minC = input.minPriceCents != null ? Number(input.minPriceCents) : null;
  if (maxC != null || minC != null) {
    out = out.filter((h) => {
      const v = h.valuations[0];
      const sold =
        h.result && !h.result.rna && h.result.priceCents != null ? n(h.result.priceCents) : null;
      const lo = v ? n(v.predPriceLowCents) : sold;
      const hi = v ? n(v.predPriceHighCents) : sold;
      if (maxC != null && (lo == null || lo > maxC)) return false;
      if (minC != null && (hi == null || hi < minC)) return false;
      return true;
    });
  }

  const total = out.length;
  const limit = Math.min(Number(input.limit ?? 25) || 25, 50);
  const hips = out.slice(0, limit).map((h) => {
    const v = h.valuations[0];
    const cur = h.sale.currency;
    const sold =
      h.result && !h.result.rna && h.result.priceCents != null ? n(h.result.priceCents) : null;
    return {
      hip: h.hipNumber,
      sale: `${h.sale.auctionHouse} ${h.sale.name} ${h.sale.year}`,
      sire: h.horse.sire?.name ?? null,
      dam: h.horse.dam?.name ?? null,
      sex: h.horse.sex,
      consignor: h.consignor?.name ?? null,
      soldFor: sold != null ? formatMoney(sold, cur) : null,
      estimate: v
        ? `${formatMoney(n(v.predPriceLowCents)!, cur)}–${formatMoney(n(v.predPriceHighCents)!, cur)}`
        : null,
      hiddenGem: v?.hiddenGemScore != null && v.hiddenGemScore > 0,
      breeze: h.breezeTime ?? null,
      raceRecord: h.horse.starts != null ? `${h.horse.starts} starts, ${h.horse.wins ?? 0} wins` : null,
    };
  });

  return { total, returned: hips.length, hips };
}

async function compareSire(input: Record<string, unknown>) {
  const norm = normalizeEntityName(String(input.sireName ?? ''));
  if (!norm) return { error: 'sireName required' };
  const rows = await prisma.$queryRawUnsafe<
    Array<{ house: string; cur: string; n: bigint; med: number; avg: number }>
  >(
    `SELECT s."auctionHouse" AS house, s."currency" AS cur, count(*) AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r."priceCents") AS med,
            avg(r."priceCents") AS avg
     FROM "SaleResult" r
     JOIN "Hip" h ON h."id" = r."hipId"
     JOIN "Sale" s ON s."id" = h."saleId"
     JOIN "Horse" yh ON yh."id" = h."horseId"
     JOIN "Horse" sire ON sire."id" = yh."sireId"
     WHERE r."rna" = false AND r."priceCents" > 0 AND sire."normalizedName" = $1
     GROUP BY s."auctionHouse", s."currency"
     ORDER BY count(*) DESC`,
    norm,
  );
  return {
    sire: input.sireName,
    totalSold: rows.reduce((a, r) => a + Number(r.n), 0),
    byHouse: rows.map((r) => ({
      house: r.house,
      sold: Number(r.n),
      median: formatMoney(Math.round(Number(r.med)), r.cur),
      average: formatMoney(Math.round(Number(r.avg)), r.cur),
    })),
  };
}
