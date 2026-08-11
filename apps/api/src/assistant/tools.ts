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
      'List sales in the catalog. Use to answer "which sales do I have", or to find a sale id to scope a hip search. Each sale carries a status: "upcoming" (has not run yet) or "concluded" (already ran — results in, or start date passed). When the user asks about an upcoming sale, filter status="upcoming" — never infer upcoming from the year. Optionally filter by category, year, or auction house.',
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
        status: { type: 'string', enum: ['upcoming', 'concluded'] },
      },
    },
  },
  {
    name: 'search_hips',
    description:
      'Search hips across all sales (or one sale via saleId). Filter by sire, dam, consignor, sex, budget (cents), sold-only, or specific hip numbers. Use for questions like "find all horses by Into Mischief" or "colts consigned by Taylor Made under $200k". If specific hip numbers are missing from the sale the user named, re-search those hipNumbers WITHOUT saleId to find which sale they belong to — hip numbers are per-sale, and some houses number sibling catalogs as one sequence.',
    input_schema: {
      type: 'object',
      properties: {
        sireName: { type: 'string' },
        damName: { type: 'string' },
        consignorName: { type: 'string' },
        sex: { type: 'string', enum: ['COLT', 'FILLY', 'GELDING', 'MARE', 'STALLION'] },
        saleId: { type: 'string', description: 'Scope to one sale (from list_sales).' },
        hipNumbers: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Look up specific hip numbers (with saleId, or across all sales without it).',
        },
        minPriceCents: { type: 'integer' },
        maxPriceCents: { type: 'integer' },
        soldOnly: { type: 'boolean', description: 'Only hips that have already sold.' },
        sortBy: {
          type: 'string',
          enum: ['price_high', 'price_low'],
          description:
            'Order before truncating — use price_high for "priciest/top", price_low for "cheapest". Default is by sale then hip number.',
        },
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
      'Explain how a Furlong feature works (shortlists, alerts, valuation, compare, breeze, calendar, profile, search). Use for "how do shortlists work" style questions.',
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
    include: {
      _count: { select: { hips: true } },
      // Existence probe: any realized result means the sale has run.
      hips: { where: { result: { isNot: null } }, take: 1, select: { id: true } },
    },
  });
  // Same real-state lifecycle as GET /sales: a sale is CONCLUDED once it has any
  // realized result OR its start date has passed (undated: year fallback) —
  // never guess "upcoming" from the year alone.
  const now = Date.now();
  const thisYear = new Date().getUTCFullYear();
  const status = (s: (typeof sales)[number]): 'upcoming' | 'concluded' =>
    s.hips.length > 0 || (s.startDate ? s.startDate.getTime() < now : s.year < thisYear)
      ? 'concluded'
      : 'upcoming';

  let mapped = sales.map((s) => ({
    id: s.id,
    house: s.auctionHouse,
    name: s.name,
    year: s.year,
    startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
    status: status(s),
    category: s.category,
    currency: s.currency,
    hips: s._count.hips,
  }));
  if (input.status === 'upcoming' || input.status === 'concluded') {
    mapped = mapped.filter((s) => s.status === input.status);
  }

  // Accurate aggregate counts over the FULL (filtered) set (the list is capped).
  const byHouse: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const s of mapped) {
    byHouse[s.house] = (byHouse[s.house] ?? 0) + 1;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  }
  return {
    count: mapped.length,
    byHouse,
    byCategory,
    note: mapped.length > 80 ? 'sales[] is capped at 80; byHouse/byCategory are exact totals' : undefined,
    sales: mapped.slice(0, 80),
  };
}

async function searchHips(input: Record<string, unknown>) {
  const where: Record<string, unknown> = {};
  if (input.saleId) where.saleId = String(input.saleId);
  if (Array.isArray(input.hipNumbers) && input.hipNumbers.length) {
    where.hipNumber = { in: input.hipNumbers.map((x) => Number(x)).filter(Number.isInteger) };
  }
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

  // Sort BEFORE truncating, so "priciest/cheapest/best value" reflect the whole
  // match set, not an arbitrary slice. Price = sold price if settled, else the
  // predicted-band midpoint. (Cross-currency sorts compare raw minor units — fine
  // for single-currency sires, approximate otherwise.)
  const priceOf = (h: (typeof out)[number]): number => {
    const sold =
      h.result && !h.result.rna && h.result.priceCents != null ? n(h.result.priceCents) : null;
    if (sold != null) return sold;
    const v = h.valuations[0];
    return v ? ((n(v.predPriceLowCents) ?? 0) + (n(v.predPriceHighCents) ?? 0)) / 2 : 0;
  };
  const sortBy = String(input.sortBy ?? '');
  if (sortBy === 'price_high') out.sort((a, b) => priceOf(b) - priceOf(a));
  else if (sortBy === 'price_low') out.sort((a, b) => priceOf(a) - priceOf(b));

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
      // limitedComparables surfaces the thin-data warning so Secretariat can
      // caveat rather than over-trust a sparse estimate.
      limitedComparables: v?.limitedComparables ?? null,
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
