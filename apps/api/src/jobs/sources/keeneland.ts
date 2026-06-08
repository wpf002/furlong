/**
 * Keeneland source adapter.
 *
 * TS port of services/ml/scripts/fetch_keeneland_september.py — the same public
 * "Sale Summaries" backend behind https://flex.keeneland.com/summaries.
 *   GET /misc/GenerateJson.do?actionName=SalesSummarySales        -> sale list
 *   GET /misc/GenerateJson.do?actionName=SalesSummary
 *       &paramNames=sale_id^!^session&paramValues=<id>^!^<n>      -> per-hip rows
 *
 * We cover the September Yearling Sale (YEARLING) and the November Breeding Stock
 * Sale (BREEDING_STOCK). Discovery emits a calendar shell per matching sale the
 * feed advertises for the requested years; the feed lists upcoming sales with a
 * sale_id before any rows exist, so fetchSale returns null until the catalog
 * actually drops — which is exactly when the ingest job should pick it up.
 */
import { request } from 'undici';
import type { SourceAdapter, DiscoveredSale, FetchedSale, CatalogHip } from './types.js';

const FLEX = 'https://flex.keeneland.com/misc/GenerateJson.do';
const HDR = { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' };
const DELIM = '^!^';

// Sale-description substring -> (display name, SaleCategory).
const TRACKED: ReadonlyArray<readonly [string, string, string]> = [
  ['September Yearling Sale', 'September Yearling Sale', 'YEARLING'],
  ['November Breeding Stock Sale', 'November Breeding Stock Sale', 'BREEDING_STOCK'],
];

const SEX: Record<string, string> = {
  COLT: 'COLT', FILLY: 'FILLY', GELDING: 'GELDING', RIDGLING: 'COLT',
  MARE: 'MARE', STALLION: 'STALLION', HORSE: 'STALLION',
};
const COLOR: Record<string, string> = {
  B: 'Bay', BAY: 'Bay', BL: 'Black', BLK: 'Black', BLACK: 'Black',
  CH: 'Chestnut', CHESTNUT: 'Chestnut', 'DB/BR': 'Dark Bay or Brown',
  'DKB/BR': 'Dark Bay or Brown', DKBBR: 'Dark Bay or Brown', GR: 'Gray',
  GRAY: 'Gray', GREY: 'Gray', RO: 'Roan', 'GR/RO': 'Gray or Roan',
  GRRO: 'Gray or Roan', WH: 'White', PAL: 'Palomino', PALOMINO: 'Palomino',
};

interface KeeSale {
  sale_id: string;
  sale_description?: string;
  number_of_sessions?: number | string;
}
interface KeeRow {
  Hip?: string | number;
  Name?: string;
  Sex?: string;
  Color?: string;
  Sire?: string;
  Dam?: string;
  Consignor?: string;
  Buyer?: string;
  SalePrice?: unknown;
  OutIndicator?: string;
  RnaIndicator?: string;
  _session?: number;
}

async function getJson(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const res = await request(`${FLEX}?${qs}`, {
    headers: HDR,
    headersTimeout: 60_000,
    bodyTimeout: 120_000,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`KEE ${res.statusCode}`);
  return res.body.json();
}

async function listSales(): Promise<KeeSale[]> {
  const d = (await getJson({ actionName: 'SalesSummarySales', paramNames: '', paramValues: '' })) as
    | KeeSale[]
    | unknown;
  return Array.isArray(d) ? d : [];
}

function match(desc: string): { name: string; category: string } | null {
  for (const [needle, name, category] of TRACKED) {
    if (desc.includes(needle)) return { name, category };
  }
  return null;
}

function yearOf(desc: string): number | null {
  const m = desc.match(/(\d{4})/);
  return m ? parseInt(m[1]!, 10) : null;
}

function mapSex(v: string | undefined): string | null {
  return v ? (SEX[v.trim().toUpperCase()] ?? null) : null;
}
function mapColor(v: string | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toUpperCase();
  return COLOR[k] ?? (v.trim() || null);
}
function cleanConsignor(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim().replace(/,?\s*Agent\b.*$/i, '').trim().replace(/,$/, '');
  return s || null;
}

async function fetchSession(saleId: string, session: number): Promise<KeeRow[]> {
  try {
    const d = (await getJson({
      actionName: 'SalesSummary',
      paramNames: `sale_id${DELIM}session`,
      paramValues: `${saleId}${DELIM}${session}`,
    })) as KeeRow[] | unknown;
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export const keenelandAdapter: SourceAdapter = {
  key: 'KEENELAND',
  label: 'Keeneland',

  async discoverSales(years: number[]): Promise<DiscoveredSale[]> {
    let sales: KeeSale[];
    try {
      sales = await listSales();
    } catch {
      return [];
    }
    const out: DiscoveredSale[] = [];
    for (const s of sales) {
      const desc = s.sale_description ?? '';
      const m = match(desc);
      const year = yearOf(desc);
      if (!m || year == null || !years.includes(year)) continue;
      out.push({
        source: 'KEENELAND',
        code: String(s.sale_id),
        saleName: m.name,
        year,
        currency: 'USD',
        category: m.category,
        startDate: null,
        endDate: null,
      });
    }
    return out;
  },

  async fetchSale(code: string): Promise<FetchedSale | null> {
    let sales: KeeSale[];
    try {
      sales = await listSales();
    } catch {
      return null;
    }
    const sale = sales.find((s) => String(s.sale_id) === String(code));
    if (!sale) return null;
    const desc = sale.sale_description ?? '';
    const m = match(desc);
    const year = yearOf(desc);
    if (!m || year == null) return null;

    const nSessions = Math.max(1, parseInt(String(sale.number_of_sessions ?? 1), 10) || 1);
    const rows: KeeRow[] = [];
    for (let s = 1; s <= nSessions; s++) {
      const recs = await fetchSession(code, s);
      for (const r of recs) r._session = s;
      rows.push(...recs);
    }
    if (rows.length === 0) return null;

    const isYearling = m.category === 'YEARLING';
    const hips: CatalogHip[] = [];
    const seen = new Set<number>();
    const lines = ['hipNumber,priceCents,rna,buyer'];
    for (const r of rows) {
      const hip = parseInt(String(r.Hip ?? '').trim(), 10);
      if (!Number.isFinite(hip)) continue;
      const out = (r.OutIndicator ?? '').trim().toUpperCase() === 'Y';
      const rna = ['Y', 'P'].includes((r.RnaIndicator ?? '').trim().toUpperCase());
      if (!seen.has(hip)) {
        seen.add(hip);
        hips.push({
          hipNumber: hip,
          sessionNumber: r._session ?? null,
          name: (r.Name ?? '').trim() || null,
          sex: mapSex(r.Sex),
          color: mapColor(r.Color),
          foalingYear: isYearling ? year - 1 : null,
          sireName: (r.Sire ?? '').trim() || null,
          damName: (r.Dam ?? '').trim() || null,
          damsireName: null,
          consignorName: cleanConsignor(r.Consignor),
          breederName: null,
        });
      }
      if (out) continue;
      const price = Number(r.SalePrice ?? 0);
      const buyer = (r.Buyer ?? '').trim().replace(/,/g, ' ');
      if (!rna && Number.isFinite(price) && price > 0) {
        lines.push(`${hip},${Math.round(price * 100)},false,${buyer}`);
      } else {
        lines.push(`${hip},,true,`);
      }
    }

    return {
      saleName: m.name,
      year,
      currency: 'USD',
      category: m.category,
      auctionHouse: 'KEENELAND',
      hips,
      resultsCsv: lines.join('\n') + '\n',
    };
  },
};
