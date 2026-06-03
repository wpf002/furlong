import { z } from 'zod';

// A single parsed catalog entry (one hip). The ML parser emits these.
export const CatalogHipSchema = z.object({
  hipNumber: z.number().int().positive(),
  sessionNumber: z.number().int().positive().nullable(),
  name: z.string().nullable(),
  sex: z.enum(['COLT', 'FILLY', 'GELDING', 'MARE', 'STALLION']).nullable(),
  color: z.string().nullable(),
  foalingYear: z.number().int().nullable(),
  sireName: z.string().nullable(),
  damName: z.string().nullable(),
  damsireName: z.string().nullable(),
  consignorName: z.string().nullable(),
  breederName: z.string().nullable(),
});
export type CatalogHip = z.infer<typeof CatalogHipSchema>;

// One block the parser detected but could not turn into a hip. Logged, never
// silently dropped — this is how we hold the >95% parse-rate acceptance bar.
export const ParseSkipSchema = z.object({
  page: z.number().int().nonnegative(),
  reason: z.string(),
  snippet: z.string(), // leading text of the offending block, for triage
});
export type ParseSkip = z.infer<typeof ParseSkipSchema>;

// Per-parse accounting. parseRate = hipsParsed / max(blocksDetected, 1).
export const ParseReportSchema = z.object({
  pagesScanned: z.number().int().nonnegative(),
  blocksDetected: z.number().int().nonnegative(),
  hipsParsed: z.number().int().nonnegative(),
  hipsSkipped: z.number().int().nonnegative(),
  parseRate: z.number().min(0).max(1),
  skipped: z.array(ParseSkipSchema),
});
export type ParseReport = z.infer<typeof ParseReportSchema>;

export const ParseCatalogResponseSchema = z.object({
  auctionHouse: z.enum(['KEENELAND', 'FASIG_TIPTON', 'TATTERSALLS', 'GOFFS', 'OBS', 'INGLIS']),
  saleName: z.string(),
  year: z.number().int(),
  hips: z.array(CatalogHipSchema),
  report: ParseReportSchema,
});
export type ParseCatalogResponse = z.infer<typeof ParseCatalogResponseSchema>;

// Valuation request/response between api <-> ml service.
export const ValuationRequestSchema = z.object({
  hipId: z.string(),
  features: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
});
export type ValuationRequest = z.infer<typeof ValuationRequestSchema>;

export const ValuationResponseSchema = z.object({
  estValueLowCents: z.number().int(),
  estValueHighCents: z.number().int(),
  predPriceLowCents: z.number().int(),
  predPriceHighCents: z.number().int(),
  confidence: z.number().min(0).max(1),
  modelVersion: z.string(),
  limitedComparables: z.boolean(),
});
export type ValuationResponse = z.infer<typeof ValuationResponseSchema>;

// ---------------------------------------------------------------------------
// Entity resolution. The same sire/dam/consignor must collapse to one row
// across years and spelling variants — this is the backbone of the learning
// loop. normalizeEntityName is the single source of truth for match keys;
// both the API ingest and any backfill use it. Display names keep original
// casing; matching is done on the normalized form.
// ---------------------------------------------------------------------------

const COUNTRY_SUFFIX = /\s*\((?:IRE|GB|USA|US|FR|GER|CAN|AUS|NZ|JPN|ARG|BRZ|ITY|SAF|CHI|URU)\)\s*$/i;

/**
 * Normalize a horse/consignor/breeder name into a stable match key:
 * lowercased, country suffix stripped, punctuation removed, whitespace
 * collapsed. Returns null for empty/whitespace input.
 */
export function normalizeEntityName(name: string | null | undefined): string | null {
  if (name == null) return null;
  let s = name.trim();
  if (!s) return null;
  s = s.replace(COUNTRY_SUFFIX, ''); // "Tapit (USA)" -> "Tapit"
  s = s.toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[.,'`’]/g, ''); // drop punctuation that varies between sources
  s = s.replace(/[^a-z0-9]+/g, ' '); // any other separator -> space
  s = s.replace(/\s+/g, ' ').trim();
  return s || null;
}

// ---------------------------------------------------------------------------
// Money. Invariant: all money is integer cents. Prisma stores BigInt; the wire
// format (JSON) and the ML service use plain numbers. Cents fit safely in a JS
// number up to Number.MAX_SAFE_INTEGER (~$90 trillion), which is far beyond any
// yearling price — but we assert it rather than assume it.
// ---------------------------------------------------------------------------

/** Convert a BigInt/number cents value to a JS number, asserting it is safe. */
export function centsToNumber(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'bigint' ? Number(v) : v;
  if (!Number.isSafeInteger(n)) {
    throw new Error(`money value ${v} exceeds safe integer range for cents`);
  }
  return n;
}

/** Convert a JS number of cents to BigInt for storage. Rejects non-integers. */
export function numberToCents(n: number): bigint {
  if (!Number.isInteger(n)) {
    throw new Error(`money must be whole integer cents, got ${n}`);
  }
  return BigInt(n);
}

/**
 * Format cents as a US dollar string, e.g. 15000000 -> "$150,000". Tolerant of
 * fractional cents (e.g. a rounded band midpoint) — rounds to the nearest cent
 * rather than throwing, since this is display-only.
 */
export function formatCents(v: bigint | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const raw = typeof v === 'bigint' ? Number(v) : v;
  if (!Number.isFinite(raw)) return '—';
  // Bloodstock prices are always whole dollars — round to the nearest dollar
  // and never show cents (band midpoints can land on a half-dollar otherwise).
  const dollars = Math.round(raw / 100);
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/**
 * Recursively convert BigInt values to numbers so a payload can be JSON
 * serialized (JSON.stringify throws on BigInt). Asserts each value is safe.
 * Use at the API boundary on anything coming out of Prisma.
 */
export function bigintToNumberDeep<T>(value: T): T {
  if (typeof value === 'bigint') {
    return centsToNumber(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => bigintToNumberDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = bigintToNumberDeep(v);
    }
    return out as T;
  }
  return value;
}

// Buyer search query coming from the web app.
export const SearchQuerySchema = z.object({
  saleId: z.string(),
  budgetLowCents: z.number().int().nonnegative().optional(),
  budgetHighCents: z.number().int().positive().optional(),
  preferredSires: z.array(z.string()).optional(),
  hiddenGemsOnly: z.boolean().optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
