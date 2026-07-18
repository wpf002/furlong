/**
 * Fasig-Tipton source adapter (reference implementation).
 *
 * TS port of services/ml/scripts/fetch_ft_yearlings.py — the same Django data
 * API, the same sale-code scheme, the same name/price hygiene — so the automated
 * pipeline produces byte-identical ingest payloads to the manual fetcher.
 *
 *   GET /django/api/sales/?sale_identifier=<code>  -> [{ id, sale_date, ... }]
 *   GET /django/api/horses/?sale=<id>              -> hips + results
 *
 * Sale codes follow {location}{yy}{suffix}; we cover the yearling sales only
 * (2YO / breeding stock are different markets and would corrupt comparables).
 */
import { request } from 'undici';
import type {
  SourceAdapter,
  DiscoveredSale,
  FetchedSale,
  CatalogHip,
} from './types.js';

const FT = 'https://www.fasigtipton.com/django/api';
const HDR = { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' };

// (location letter, suffix letter, sale name)
const SALES: ReadonlyArray<readonly [string, string, string]> = [
  ['K', 'B', 'The July Sale'],
  ['N', 'A', 'The Saratoga Sale'],
  ['N', 'B', 'New York Bred Yearlings'],
  ['K', 'C', 'Kentucky October Yearlings'],
  ['C', 'B', 'California Fall Yearlings'],
  ['M', 'B', 'Midlantic Fall Yearlings'],
];

const SEX: Record<string, string> = {
  C: 'COLT', F: 'FILLY', G: 'GELDING', R: 'COLT', H: 'STALLION', M: 'MARE',
};
const COLOR: Record<string, string> = {
  B: 'Bay', BAY: 'Bay', DKB: 'Dark Bay or Brown', DB: 'Dark Bay or Brown',
  DKBBR: 'Dark Bay or Brown', CH: 'Chestnut', CHE: 'Chestnut', GR: 'Gray',
  GRO: 'Gray or Roan', RO: 'Roan', BL: 'Black', BLK: 'Black', WH: 'White',
  PA: 'Palomino',
};

function smartTitle(name: string | null | undefined): string | null {
  if (!name) return null;
  let s = String(name).trim();
  if (!s) return null;
  const letters = [...s].filter((c) => /[a-zA-Z]/.test(c));
  if (letters.length > 0 && letters.every((c) => c === c.toUpperCase())) {
    s = s.toLowerCase().replace(/(^|[^A-Za-z'’])([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  }
  return s;
}

function foalingYear(yob: unknown): number | null {
  if (yob == null) return null;
  const m = String(yob).match(/(\d{4})/);
  return m ? parseInt(m[1]!, 10) : null;
}

interface FtHorse {
  hip?: number | string;
  session?: unknown;
  name?: string;
  sex?: string;
  color?: string;
  year_of_birth?: unknown;
  sire?: string;
  dam?: string;
  sire_of_dam?: string;
  consignor_name?: string;
  purchaser?: string;
  price?: unknown;
  out?: unknown;
  covering_sire?: string;
}

async function getJson(url: string): Promise<unknown> {
  const res = await request(url, { headers: HDR, headersTimeout: 60_000, bodyTimeout: 120_000 });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`FT ${url} -> ${res.statusCode}`);
  }
  return res.body.json();
}

async function resolveSale(code: string): Promise<{ id: number | string; date?: string } | null> {
  const d = (await getJson(`${FT}/sales/?sale_identifier=${encodeURIComponent(code)}`)) as
    | Array<{ id: number | string; sale_date?: string; start_date?: string }>
    | unknown;
  if (Array.isArray(d) && d.length > 0) {
    return { id: d[0].id, date: d[0].sale_date ?? d[0].start_date };
  }
  return null;
}

async function fetchHorses(saleId: number | string): Promise<FtHorse[]> {
  const d = (await getJson(`${FT}/horses/?sale=${encodeURIComponent(String(saleId))}`)) as
    | FtHorse[]
    | { results?: FtHorse[] };
  return Array.isArray(d) ? d : (d.results ?? []);
}

function buildHips(horses: FtHorse[]): CatalogHip[] {
  return horses.map((h) => {
    let nm: string | null = (h.name ?? '').trim() || null;
    // FT labels unnamed yearlings "YYYY-<dam>"; treat those as unnamed.
    if (nm && /^(19|20)\d\d[\s-]/.test(nm)) nm = null;
    return {
      hipNumber: parseInt(String(h.hip), 10),
      sessionNumber: typeof h.session === 'number' ? h.session : null,
      name: nm ? smartTitle(nm) : null,
      sex: SEX[(h.sex ?? '').trim().toUpperCase()] ?? null,
      color: COLOR[(h.color ?? '').trim().toUpperCase()] ?? null,
      foalingYear: foalingYear(h.year_of_birth),
      sireName: smartTitle(h.sire),
      damName: smartTitle(h.dam),
      damsireName: smartTitle(h.sire_of_dam),
      consignorName: smartTitle(h.consignor_name),
      breederName: null,
      coveringSireName: smartTitle(h.covering_sire),
    };
  });
}

function buildResultsCsv(horses: FtHorse[]): string {
  const lines = ['hipNumber,priceCents,rna,buyer'];
  for (const h of horses) {
    if (h.out) continue; // withdrawn / scratched — not part of the sale
    const p = Number(h.price ?? 0);
    const price = Number.isFinite(p) ? p : 0;
    const buyer = (h.purchaser ?? '').trim().replace(/,/g, ' ');
    const marker = buyer.toUpperCase();
    // FT lists the final bid as `price` even when the reserve wasn't met, so
    // price > 0 does NOT mean sold — the purchaser reads "NOT SOLD". Classify by
    // the purchaser:
    //   • "NOT SOLD" / "RNA"  → reserve not attained → explicit RNA row.
    //   • a real purchaser     → a sale.
    //   • empty + no price     → not sold yet (upcoming sale) → skip, so the
    //                            catalog shows predictions rather than RNA.
    if (marker === 'NOT SOLD' || marker === 'RNA') {
      lines.push(`${h.hip},,true,`);
    } else if (price > 0 && marker !== '') {
      lines.push(`${h.hip},${Math.round(price * 100)},false,${buyer}`);
    }
  }
  return lines.join('\n') + '\n';
}

export const fasigTiptonAdapter: SourceAdapter = {
  key: 'FASIG_TIPTON',
  label: 'Fasig-Tipton',

  async discoverSales(years: number[]): Promise<DiscoveredSale[]> {
    const out: DiscoveredSale[] = [];
    for (const [loc, suf, name] of SALES) {
      for (const year of years) {
        const code = `${loc}${String(year % 100).padStart(2, '0')}${suf}`;
        let sale: Awaited<ReturnType<typeof resolveSale>>;
        try {
          sale = await resolveSale(code);
        } catch {
          continue; // transient / not published yet
        }
        if (!sale) continue;
        out.push({
          source: 'FASIG_TIPTON',
          code,
          saleName: name,
          year,
          currency: 'USD',
          category: 'YEARLING',
          startDate: sale.date ? new Date(sale.date).toISOString() : null,
          endDate: null,
        });
      }
    }
    return out;
  },

  async fetchSale(code: string): Promise<FetchedSale | null> {
    const sale = await resolveSale(code);
    if (!sale) return null;
    const horses = await fetchHorses(sale.id);
    if (horses.length === 0) return null;
    // Derive sale name + year from the code: <loc><yy><suf>.
    const yy = parseInt(code.slice(1, 3), 10);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const match = SALES.find(([l, s]) => code.startsWith(l) && code.endsWith(s));
    const saleName = match ? match[2] : code;
    return {
      saleName,
      year,
      currency: 'USD',
      category: 'YEARLING',
      auctionHouse: 'FASIG_TIPTON',
      hips: buildHips(horses),
      resultsCsv: buildResultsCsv(horses),
      catalogPdfUrl: ftCatalogUrl(sale.date),
    };
  },
};

// FT publishes each catalog at /catalogs/<YYYY>/<MMDD>/web.pdf, keyed by the
// sale's start date. The ingest pipeline fetches it for the black-type pages.
function ftCatalogUrl(startDate?: string): string | null {
  if (!startDate) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  if (!m) return null;
  return `https://www.fasigtipton.com/catalogs/${m[1]}/${m[2]}${m[3]}/web.pdf`;
}
