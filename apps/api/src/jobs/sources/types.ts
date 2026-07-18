/**
 * Source adapter — one per auction-house data source.
 *
 * Discovery and ingestion are decoupled so the scheduler can find new sales
 * cheaply (a calendar poll) and only fetch the (much larger) full catalog when a
 * sale is actually new. Adding a house = implementing this interface; the
 * discovery/ingest jobs are house-agnostic.
 *
 * NOTE (ROADMAP invariant): these adapters target each house's public data API
 * as LOCAL DEV/TEST plumbing. The production path is a licensed feed — the
 * DISCOVERY_ENABLED flag keeps them dormant until that path exists.
 */

export interface DiscoveredSale {
  /** Adapter key, matches AuctionHouse enum, e.g. "FASIG_TIPTON". */
  source: string;
  /** Source-specific sale identifier passed back to fetchSale(). */
  code: string;
  saleName: string;
  year: number;
  currency: string;
  category: string; // SaleCategory
  startDate: string | null; // ISO; null if the source doesn't expose it yet
  endDate: string | null;
}

export interface CatalogHip {
  hipNumber: number;
  sessionNumber: number | null;
  name: string | null;
  sex: string | null;
  color: string | null;
  foalingYear: number | null;
  sireName: string | null;
  damName: string | null;
  damsireName: string | null;
  consignorName: string | null;
  breederName: string | null;
  /** Under-tack breeze (2YO-in-training sales only, e.g. OBS). */
  breezeTime?: string | null;
  breezeSeconds?: number | null;
}

export interface FetchedSale {
  saleName: string;
  year: number;
  currency: string;
  category: string;
  auctionHouse: string;
  hips: CatalogHip[];
  /** CSV body for POST /ingest/results (hipNumber,priceCents,rna,buyer). */
  resultsCsv: string;
  /**
   * URL of the sale's catalog PDF, if the house publishes one. The ingest
   * pipeline fetches it to capture each hip's black-type "catalog page" text
   * (which the structured API doesn't carry) so pedigree grades compute. Null
   * for sources whose structured feed already includes page text, or none.
   */
  catalogPdfUrl?: string | null;
}

export interface SourceAdapter {
  /** AuctionHouse key. */
  readonly key: string;
  /** Human label for logs. */
  readonly label: string;
  /**
   * Find sales the source currently advertises for the given years. Cheap; does
   * NOT fetch full catalogs. Returns every sale it can see — the discovery job
   * diffs against the DB to decide what's actually new.
   */
  discoverSales(years: number[]): Promise<DiscoveredSale[]>;
  /** Fetch the full catalog + results for one sale. */
  fetchSale(code: string): Promise<FetchedSale | null>;
}
