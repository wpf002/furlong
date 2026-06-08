/**
 * Tattersalls source adapter (guineas).
 *
 * TS port of services/ml/scripts/fetch_tattersalls.py. The 4D web server serves
 * the sold-lot table behind a session cookie obtained from the sale's /Main page:
 *   GET /4DCGI/Sale/<CODE>/Main           -> primes the session cookie
 *   GET /4DCGI/Sale/<CODE>/Top%20Lots/N   -> sold lots (rank, lot, breeding, …)
 * Sale code = OC<book><yy> (OC125 = October Book 1 2025).
 *
 * The October Yearling Sale Books 1–3 are real recurring annual sales, so
 * discovery emits a calendar shell for each book/year (dates unknown from this
 * feed). fetchSale returns the SOLD set, which only exists after the sale — i.e.
 * the ingest job naturally backfills results once they're published.
 */
import { request } from 'undici';
import type { SourceAdapter, DiscoveredSale, FetchedSale, CatalogHip } from './types.js';

const BASE = 'https://secure.tattersalls.com/4DCGI/Sale';
const HDR = { 'User-Agent': 'Mozilla/5.0' };
const BOOKS = [1, 2, 3] as const;

const COUNTRY =
  /\s*\((?:IRE|GB|FR|USA|GER|ITY|JPN|CAN|AUS|NZ|ARG|SAF|SPA|SWI)\)\s*/gi;
const COLORSEX = /\b([A-Za-z]{1,3}(?:\/[A-Za-z]{1,3})?)\.([CFGR])\./;
const COLOR: Record<string, string> = {
  b: 'Bay', ch: 'Chestnut', gr: 'Gray', br: 'Brown', bl: 'Black',
  ro: 'Roan', 'gr/ro': 'Gray or Roan', 'b/br': 'Bay or Brown',
};
const SEX: Record<string, string> = { C: 'COLT', F: 'FILLY', G: 'GELDING', R: 'COLT' };

function unescapeHtml(s: string): string {
  return (
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      // Spacing entities (&nbsp; &ensp; &emsp; &thinsp; and their numeric forms)
      // -> a plain space; then drop any other leftover named/numeric entity so
      // it can't corrupt a numeric cell (e.g. a lot rendered as "90 &ensp;").
      .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;|&hairsp;|&#8194;|&#8195;|&#8201;/gi, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
  );
}
function stripCountry(s: string): string {
  return (s || '').replace(COUNTRY, '').trim();
}

interface Lot {
  lot: number;
  sire: string | null;
  dam: string | null;
  color: string | null;
  sex: string | null;
  consignor: string | null;
  purchaser: string | null;
  guineas: number;
}

function parseLots(htmlText: string): Lot[] {
  const out: Lot[] = [];
  const rows = htmlText.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const r of rows) {
    const cellRaw = r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cellRaw.length !== 6) continue;
    const cells = cellRaw.map((c) =>
      unescapeHtml(c.replace(/<t[dh][^>]*>/i, '').replace(/<\/t[dh]>/i, '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    );
    const [, lot, breeding, consignor, purchaser, price] = cells;
    const lotNum = parseInt((lot ?? '').match(/\d+/)?.[0] ?? '', 10);
    if (!Number.isFinite(lotNum) || !/\d/.test(price ?? '')) continue;
    let sire: string | null = null;
    let dam: string | null = null;
    let color: string | null = null;
    let sex: string | null = null;
    if (breeding!.includes('/')) {
      const idx = breeding!.indexOf('/');
      const left = breeding!.slice(0, idx);
      const right = breeding!.slice(idx + 1);
      sire = stripCountry(left) || null;
      const m = COLORSEX.exec(right);
      if (m) {
        color = COLOR[m[1]!.toLowerCase()] ?? m[1]!;
        sex = SEX[m[2]!] ?? null;
        dam = stripCountry(right.slice(0, m.index)) || null;
      } else {
        dam = stripCountry(right) || null;
      }
    }
    out.push({
      lot: lotNum,
      sire,
      dam,
      color,
      sex,
      consignor: consignor || null,
      purchaser: purchaser || null,
      guineas: parseInt(price!.replace(/[^\d]/g, '') || '0', 10),
    });
  }
  return out;
}

async function fetchLots(code: string): Promise<Lot[]> {
  // 1) Prime the session cookie from /Main.
  const main = await request(`${BASE}/${code}/Main`, {
    headers: HDR,
    maxRedirections: 5,
    headersTimeout: 60_000,
    bodyTimeout: 120_000,
  });
  await main.body.dump();
  const setCookie = main.headers['set-cookie'];
  const cookie = Array.isArray(setCookie)
    ? setCookie.map((c) => c.split(';')[0]).join('; ')
    : typeof setCookie === 'string'
      ? setCookie.split(';')[0]
      : '';
  // 2) Pull the sold-lot table.
  const res = await request(`${BASE}/${code}/Top%20Lots/5000`, {
    headers: cookie ? { ...HDR, cookie } : HDR,
    maxRedirections: 5,
    headersTimeout: 60_000,
    bodyTimeout: 120_000,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    await res.body.dump();
    return [];
  }
  return parseLots(await res.body.text());
}

export const tattersallsAdapter: SourceAdapter = {
  key: 'TATTERSALLS',
  label: 'Tattersalls',

  async discoverSales(years: number[]): Promise<DiscoveredSale[]> {
    const out: DiscoveredSale[] = [];
    for (const year of years) {
      for (const book of BOOKS) {
        out.push({
          source: 'TATTERSALLS',
          code: `OC${book}${String(year % 100).padStart(2, '0')}`,
          saleName: `October Yearling Sale Book ${book}`,
          year,
          currency: 'GNS',
          category: 'YEARLING',
          startDate: null,
          endDate: null,
        });
      }
    }
    return out;
  },

  async fetchSale(code: string): Promise<FetchedSale | null> {
    const m = code.match(/^OC(\d)(\d{2})$/);
    if (!m) return null;
    const book = parseInt(m[1]!, 10);
    const yy = parseInt(m[2]!, 10);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;

    let lots: Lot[];
    try {
      lots = await fetchLots(code);
    } catch {
      return null;
    }
    lots = lots.filter((l) => l.guineas > 0 && (l.sire || l.dam));
    if (lots.length === 0) return null;
    // Sanity: top Book yearlings are 6–7 figures — a low ceiling means we parsed
    // the wrong table (or an empty/placeholder page).
    const top = Math.max(...lots.map((l) => l.guineas));
    if (top < 10_000) return null;

    const hips: CatalogHip[] = [];
    const seen = new Set<number>();
    const lines = ['hipNumber,priceCents,rna,buyer'];
    for (const l of lots) {
      if (seen.has(l.lot)) continue;
      seen.add(l.lot);
      hips.push({
        hipNumber: l.lot,
        sessionNumber: null,
        name: null,
        sex: l.sex,
        color: l.color,
        foalingYear: year - 1,
        sireName: l.sire,
        damName: l.dam,
        damsireName: null,
        consignorName: l.consignor,
        breederName: null,
      });
      lines.push(`${l.lot},${l.guineas * 100},false,${(l.purchaser ?? '').replace(/,/g, ' ')}`);
    }

    return {
      saleName: `October Yearling Sale Book ${book}`,
      year,
      currency: 'GNS',
      category: 'YEARLING',
      auctionHouse: 'TATTERSALLS',
      hips,
      resultsCsv: lines.join('\n') + '\n',
    };
  },
};
