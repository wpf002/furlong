// Fetch the 2026 Keeneland sales that already have data (January Horses of All
// Ages, April Selected Horses of Racing Age) and load them so they appear on the
// calendar alongside the historical September/November sales. Reuses the same
// flex "Sale Summaries" backend as fetch_keeneland_september.py.
//
// LOCAL DEV/TEST data; product path is a license, not scraping (ROADMAP).
// Run: node services/ml/scripts/fetch_keeneland_2026.mjs

const FLEX = 'https://flex.keeneland.com/misc/GenerateJson.do';
const API = 'http://localhost:4100';
const HDR = { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' };
const DELIM = '^!^';

const SEX = { COLT: 'COLT', FILLY: 'FILLY', GELDING: 'GELDING', RIDGLING: 'COLT', MARE: 'MARE', HORSE: 'STALLION', STALLION: 'STALLION', BROODMARE: 'MARE' };
const COLOR = { B: 'Bay', BAY: 'Bay', BL: 'Black', BLK: 'Black', BLACK: 'Black', CH: 'Chestnut', CHESTNUT: 'Chestnut', 'DB/BR': 'Dark Bay or Brown', 'DKB/BR': 'Dark Bay or Brown', DKBBR: 'Dark Bay or Brown', GR: 'Gray', GRAY: 'Gray', GREY: 'Gray', RO: 'Roan', 'GR/RO': 'Gray or Roan', WH: 'White', PAL: 'Palomino' };

// description substring -> [Furlong sale name, category]
const WANT = [
  ['January Horses of All Ages', ['January Horses of All Ages Sale', 'MIXED']],
  ['April Selected Horses of Racing Age', ['April Selected Horses of Racing Age Sale', 'TWO_YEAR_OLD']],
];

const mapSex = (v) => SEX[(v || '').trim().toUpperCase()] || null;
const mapColor = (v) => (v ? COLOR[(v).trim().toUpperCase()] || (v).trim() || null : null);
const cleanCons = (v) => (v ? v.replace(/,?\s*Agent\b.*$/i, '').trim().replace(/,$/, '') || null : null);

async function getJson(url) {
  const r = await fetch(url, { headers: HDR });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function main() {
  const list = await getJson(`${FLEX}?actionName=SalesSummarySales&paramNames=&paramValues=`);
  for (const [needle, [saleName, category]] of WANT) {
    const sale = list.find((s) => /2026/.test(s.sale_description || '') && (s.sale_description || '').includes(needle));
    if (!sale) { console.log(`2026 ${needle}: not listed`); continue; }
    const nSessions = parseInt(sale.number_of_sessions || '1', 10) || 1;
    const rows = [];
    for (let s = 1; s <= nSessions; s++) {
      const pv = `${sale.sale_id}${DELIM}${s}`;
      try {
        const recs = await getJson(`${FLEX}?actionName=SalesSummary&paramNames=sale_id${DELIM}session&paramValues=${encodeURIComponent(pv)}`);
        for (const r of recs) rows.push(r);
      } catch { /* skip session */ }
    }
    // build catalog + results
    const hips = []; const seen = new Set(); const res = ['hipNumber,priceCents,rna,buyer'];
    for (const r of rows) {
      const hip = parseInt(String(r.Hip || '').trim(), 10);
      if (!Number.isInteger(hip)) continue;
      if (!seen.has(hip)) {
        seen.add(hip);
        hips.push({
          hipNumber: hip, sessionNumber: null,
          name: (r.Name || '').trim() || null,
          sex: mapSex(r.Sex), color: mapColor(r.Color), foalingYear: null,
          sireName: (r.Sire || '').trim() || null, damName: (r.Dam || '').trim() || null,
          damsireName: null, consignorName: cleanCons(r.Consignor), breederName: null,
        });
      }
      if ((r.OutIndicator || '').trim().toUpperCase() === 'Y') continue;
      const rna = ['Y', 'P'].includes((r.RnaIndicator || '').trim().toUpperCase());
      const price = parseFloat(r.SalePrice || 0) || 0;
      const buyer = (r.Buyer || '').trim().replace(/,/g, ' ');
      if (!rna && price > 0) res.push(`${hip},${Math.round(price * 100)},false,${buyer}`);
    }
    const n = hips.length;
    const catalog = { auctionHouse: 'KEENELAND', saleName, year: 2026, category, hips,
      report: { pagesScanned: n, blocksDetected: n, hipsParsed: n, hipsSkipped: 0, parseRate: n ? 1 : 0, skipped: [] } };
    const rc = await fetch(`${API}/ingest/catalog-json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(catalog) });
    const cj = await rc.json();
    const form = new FormData();
    form.append('saleId', cj.saleId);
    form.append('file', new Blob([res.join('\n') + '\n'], { type: 'text/csv' }), 'results.csv');
    const rr = await fetch(`${API}/ingest/results`, { method: 'POST', body: form });
    const rj = await rr.json();
    await fetch(`${API}/sales/${cj.saleId}/value`, { method: 'POST' }).catch(() => {});
    const sold = res.filter((l) => l.includes(',false,')).length;
    console.log(`${saleName} 2026: ${n} hips, ${sold} sold -> ${cj.created}c/${cj.updated}u, results ${rj.imported}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
