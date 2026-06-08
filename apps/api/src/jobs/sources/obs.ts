/**
 * OBS (Ocala Breeders' Sales) source adapter — 2YO-in-training sales.
 *
 * TS port of services/ml/scripts/fetch_obs.py. Each sale renders as a jQuery
 * DataTables page with the full row set inlined as `var arrData = [[...], ...]`:
 *   GET https://www.obscatalog.com/<mon>results/<year>/
 * Columns shift between sales (April adds a 'Walk' column), so we key off the
 * <th> labels rather than fixed positions. The under-tack ("breeze") time is the
 * key 2YO signal — normalized to seconds-per-furlong and stored for valuation.
 *
 * Codes are "<mon>:<year>" (e.g. "mar:2026"). Results pages only exist after a
 * sale, so discovery emits a sale only once its page is live — the ingest job
 * then backfills it automatically on the next run.
 */
import { request } from 'undici';
import type { SourceAdapter, DiscoveredSale, FetchedSale, CatalogHip } from './types.js';

const OBS = 'https://www.obscatalog.com';
const HDR = { 'User-Agent': 'Mozilla/5.0' };

// month-code -> (sale name, category). 2YO-in-training sales only.
const SALES: Record<string, readonly [string, string]> = {
  mar: ['March Two-Year-Olds in Training Sale', 'TWO_YEAR_OLD'],
  apr: ['Spring Two-Year-Olds in Training Sale', 'TWO_YEAR_OLD'],
  jun: ['June Two-Year-Olds & Horses of Racing Age Sale', 'TWO_YEAR_OLD'],
};
const MONTHS = ['mar', 'apr', 'jun'] as const;

const SEX: Record<string, string> = {
  C: 'COLT', F: 'FILLY', G: 'GELDING', R: 'COLT', H: 'STALLION', M: 'MARE',
};

function strip(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}
function title(s: unknown): string | null {
  const v = strip(s);
  return v || null;
}

function headerMap(html: string): Record<string, number> {
  const thead = html.match(/<thead[\s\S]*?<\/thead>/i);
  if (!thead) return {};
  const labels = (thead[0].match(/<th[^>]*>[\s\S]*?<\/th>/gi) ?? []).map((x) => strip(x));
  const idx: Record<string, number> = {};
  labels.forEach((lab, i) => {
    const low = lab.toLowerCase();
    if (low.startsWith('hip')) idx.hip = i;
    else if (low.includes('ut time') || low.includes('under tack')) idx.breeze = i;
    else if (low === 'sex') idx.sex = i;
    else if (low === 'sire') idx.sire = i;
    else if (low === 'dam') idx.dam = i;
    else if (low === 'consignor') idx.consignor = i;
    else if (low === 'buyer') idx.buyer = i;
    else if (low === 'price') idx.price = i;
  });
  return idx;
}

function parseBreeze(rawIn: string): [string | null, number | null] {
  const raw = strip(rawIn);
  const m = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return [null, null];
  const whole = parseInt(m[1]!, 10);
  const frac = m[2];
  let sec: number;
  if (frac == null) sec = whole;
  else if (frac.length === 1) sec = whole + parseInt(frac, 10) / 5.0;
  else sec = parseFloat(raw);
  if (!(sec > 0)) return [null, null];
  const furlongs = sec < 15 ? 1.0 : 2.0;
  return [`${raw} (${furlongs}f)`, Math.round((sec / furlongs) * 100) / 100];
}

function priceCents(rawIn: string): number | null {
  const s = strip(rawIn).replace(/,/g, '').replace(/\$/g, '');
  if (!s || !/^\d+$/.test(s)) return null;
  const v = parseInt(s, 10);
  return v > 0 ? v * 100 : null;
}

function extractArrData(html: string): unknown[] {
  const i = html.indexOf('var arrData');
  if (i < 0) return [];
  const start = html.indexOf('[', i);
  if (start < 0) return [];
  let depth = 0;
  let end = -1;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = j + 1;
        break;
      }
    }
  }
  if (end < 0) return [];
  try {
    return JSON.parse(html.slice(start, end)) as unknown[];
  } catch {
    return [];
  }
}

async function getPage(mon: string, year: number): Promise<string | null> {
  try {
    const res = await request(`${OBS}/${mon}results/${year}/`, {
      headers: HDR,
      maxRedirections: 3,
      headersTimeout: 60_000,
      bodyTimeout: 120_000,
    });
    if (res.statusCode !== 200) {
      await res.body.dump();
      return null;
    }
    return await res.body.text();
  } catch {
    return null;
  }
}

function build(year: number, rows: unknown[], col: Record<string, number>): CatalogHip[] {
  const hips: CatalogHip[] = [];
  const seen = new Set<number>();
  const cell = (r: unknown[], key: string): unknown => {
    const i = col[key];
    return i != null && i < r.length ? r[i] : null;
  };
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const hip = parseInt(strip(cell(row, 'hip')), 10);
    if (!Number.isFinite(hip) || seen.has(hip)) continue;
    seen.add(hip);
    const [bt, bs] = parseBreeze(String(cell(row, 'breeze') ?? ''));
    hips.push({
      hipNumber: hip,
      sessionNumber: null,
      name: null,
      sex: SEX[strip(cell(row, 'sex')).toUpperCase().slice(0, 1)] ?? null,
      color: null,
      foalingYear: year - 2, // a 2YO in <year> was foaled <year>-2
      sireName: title(cell(row, 'sire')),
      damName: title(cell(row, 'dam')),
      damsireName: null,
      consignorName: title(cell(row, 'consignor')),
      breederName: null,
      breezeTime: bt,
      breezeSeconds: bs,
    });
  }
  return hips;
}

function resultsCsv(rows: unknown[], col: Record<string, number>): string {
  const lines = ['hipNumber,priceCents,rna,buyer'];
  const seen = new Set<number>();
  const cell = (r: unknown[], key: string): unknown => {
    const i = col[key];
    return i != null && i < r.length ? r[i] : null;
  };
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const hip = parseInt(strip(cell(row, 'hip')), 10);
    if (!Number.isFinite(hip) || seen.has(hip)) continue;
    seen.add(hip);
    const pc = priceCents(String(cell(row, 'price') ?? ''));
    const buyer = title(cell(row, 'buyer')) ?? '';
    if (pc) lines.push(`${hip},${pc},false,${buyer.replace(/,/g, ' ')}`);
  }
  return lines.join('\n') + '\n';
}

export const obsAdapter: SourceAdapter = {
  key: 'OBS',
  label: 'Ocala Breeders’ Sales',

  async discoverSales(years: number[]): Promise<DiscoveredSale[]> {
    const out: DiscoveredSale[] = [];
    for (const mon of MONTHS) {
      const [name, category] = SALES[mon]!;
      for (const year of years) {
        const html = await getPage(mon, year);
        if (!html) continue;
        const rows = extractArrData(html);
        const col = headerMap(html);
        if (rows.length === 0 || col.hip == null) continue;
        out.push({
          source: 'OBS',
          code: `${mon}:${year}`,
          saleName: name,
          year,
          currency: 'USD',
          category,
          startDate: null,
          endDate: null,
        });
      }
    }
    return out;
  },

  async fetchSale(code: string): Promise<FetchedSale | null> {
    const [mon, yearStr] = code.split(':');
    const year = parseInt(yearStr ?? '', 10);
    if (!mon || !SALES[mon] || !Number.isFinite(year)) return null;
    const [name, category] = SALES[mon]!;

    const html = await getPage(mon, year);
    if (!html) return null;
    const rows = extractArrData(html);
    const col = headerMap(html);
    if (rows.length === 0 || col.hip == null || col.price == null) return null;

    const hips = build(year, rows, col);
    if (hips.length === 0) return null;

    return {
      saleName: name,
      year,
      currency: 'USD',
      category,
      auctionHouse: 'OBS',
      hips,
      resultsCsv: resultsCsv(rows, col),
    };
  },
};
