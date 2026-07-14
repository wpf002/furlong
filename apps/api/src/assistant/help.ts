/**
 * Curated app-help knowledge base for Secretariat. Plain answers about how
 * Furlong works — the assistant retrieves these rather than improvising app
 * behavior it can't verify.
 */
export const HELP_TOPICS: Record<string, string> = {
  shortlists:
    'Shortlists let you save hips you like and add private notes per hip. Open a sale, hit the save (bookmark) control on any hip card to add it to a shortlist, then visit Shortlists in the top nav to review them. Each saved hip keeps its valuation and your note.',
  alerts:
    'Furlong has three alert types: CATALOG_DROP (a new catalog with your preferred sires is available), SALE_SOON (a sale you care about starts within ~48h), and CRITERIA_MATCH (hips that fit your budget AND preferred sires after the sale is valued). Alerts can be delivered by email and/or SMS — set channels under your Profile / notification settings.',
  valuation:
    'Each hip gets an estimated sale-price band — the model\'s prediction of what it will fetch at auction. Yearlings use a trained quantile model; broodmares are valued on their produce record plus their own race record; 2YOs-in-training use sire comparables adjusted by race record and under-tack breeze time. Estimates score pedigree and market comparables only — never physical or veterinary condition. Figures are rounded to the nearest $1,000.',
  compare:
    'The Compare view breaks a sire\'s sold-yearling prices down by auction house (and currency), so you can see how the same sire performs across Keeneland, Fasig-Tipton, Tattersalls, etc. Type a sire name to compare.',
  breeze:
    'For 2YO-in-training sales (e.g. OBS), the under-tack "breeze" time is the work a horse posts before the sale. Furlong normalizes it to seconds-per-furlong so 1/8- and 1/4-mile works compare; a faster-than-median breeze lifts the hip\'s valuation.',
  calendar:
    'The Calendar aggregates upcoming and past sales across all houses, showing what is coming up and when catalogs drop.',
  profile:
    'Your Profile holds your budget range and preferred sires. Furlong uses it to auto-filter a large catalog down to a focused shortlist of matches, and to decide which alerts to send you.',
  search:
    'Pick a sale, set a budget and optional preferred sires (or just "best value"), and Furlong returns a filterable hip list with an estimated sale-price band, a pedigree grade, and a one-line read on each hip.',
};

export function lookupHelp(topic: string): string {
  const t = topic.toLowerCase().trim();
  if (HELP_TOPICS[t]) return HELP_TOPICS[t];
  // loose contains-match
  for (const [k, v] of Object.entries(HELP_TOPICS)) {
    if (t.includes(k) || k.includes(t)) return v;
  }
  return (
    'Furlong is a catalog-to-shortlist tool for thoroughbred buyers: search and ' +
    'rank hips by data-driven value estimates, save shortlists with notes, compare ' +
    'sires across auction houses, and get alerts. Ask about: shortlists, alerts, ' +
    'valuation, compare, breeze, calendar, or your profile.'
  );
}
