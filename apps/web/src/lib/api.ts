import type { SearchQuery } from '@furlong/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Wire types. All money fields are plain integer cents (numbers), per the API
// contract. Render exclusively via formatCents from @furlong/shared.
// ---------------------------------------------------------------------------

export type Sex = 'COLT' | 'FILLY' | 'GELDING' | 'MARE' | 'STALLION';

export type SaleCategory =
  | 'YEARLING'
  | 'BREEDING_STOCK'
  | 'TWO_YEAR_OLD'
  | 'WEANLING'
  | 'MIXED'
  | 'OTHER';

export interface Sale {
  id: string;
  auctionHouse: string;
  name: string;
  year: number;
  startDate: string | null;
  endDate: string | null;
  currency?: string;
  category?: SaleCategory;
  hipCount?: number;
}

export interface Valuation {
  estValueLowCents: number;
  estValueHighCents: number;
  predPriceLowCents: number;
  predPriceHighCents: number;
  confidence: number; // 0..1
  hiddenGemScore: number | null;
  limitedComparables: boolean;
}

export interface SearchHipHorse {
  name: string | null;
  sex: Sex | null;
  color: string | null;
  sireName: string | null;
  damName: string | null;
  damsireName: string | null;
}

export interface SearchHip {
  id: string;
  hipNumber: number;
  sessionNumber: number | null;
  horse: SearchHipHorse;
  consignorName: string | null;
  valuation: Valuation | null;
  result: { priceCents: number | null; rna: boolean } | null;
  produce: { nFoals: number; medianFoalCents: number | null } | null;
  racing: {
    starts: number;
    wins: number;
    places: number | null;
    shows: number | null;
    earningsCents: number | null;
    bestSpeedFigure: number | null;
  } | null;
  breeze: string | null;
  oneLiner: string;
}

export interface SearchResponse {
  count: number;
  hips: SearchHip[];
  currency?: string;
}

// Shape returned by GET /sales/:id/hips — richer than the search payload.
export interface DetailHip {
  id: string;
  hipNumber: number;
  sessionNumber: number | null;
  horse: {
    name: string | null;
    sex: Sex | null;
    color: string | null;
    foalingYear?: number | null;
    breederName?: string | null;
    sire?: { name: string | null } | null;
    dam?: { name: string | null; sire?: { name: string | null } | null } | null;
  };
  consignor?: { name: string | null } | null;
  breeder?: { name: string | null } | null;
  result?: {
    priceCents?: number | null;
    status?: string | null;
  } | null;
  valuations: Valuation[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(
      `Could not reach the Furlong API at ${API_BASE}. Is the API running? (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `API ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${res.statusText}${
        detail ? ` — ${detail.slice(0, 300)}` : ''
      }`,
    );
  }

  return (await res.json()) as T;
}

export function getSales(status?: 'upcoming' | 'past' | 'all'): Promise<Sale[]> {
  const qs = status && status !== 'all' ? `?status=${status}` : '';
  return request<Sale[]>(`/sales${qs}`);
}

export function search(query: SearchQuery): Promise<SearchResponse> {
  return request<SearchResponse>('/search', {
    method: 'POST',
    body: JSON.stringify(query),
  });
}

export function getSaleHips(saleId: string): Promise<DetailHip[]> {
  return request<DetailHip[]>(`/sales/${encodeURIComponent(saleId)}/hips`);
}

export interface ModelMetrics {
  modelVersion: string | null;
  metrics: {
    improvement_pct?: number;
    p10_p90_coverage?: number;
    n_results_seen?: number;
    n_sales_seen?: number;
    model_mae_log?: number;
    baseline_mae_log?: number;
    model_beats_baseline?: boolean;
    trained_through_year?: number;
  } | null;
}

export function getModelMetrics(): Promise<ModelMetrics> {
  return request<ModelMetrics>('/model/metrics');
}

// ---------------------------------------------------------------------------
// Buyer layer (Phase 3). All /me/* endpoints require the x-user-id header,
// injected client-side via useUser().userFetch — see src/lib/useUser.ts.
// Money fields remain integer cents; budgets are entered in dollars in the UI
// and converted before sending.
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  token: string; // signed session token (Phase 4) — sent as Authorization: Bearer
}

export interface BuyerProfile {
  id: string;
  budgetLowCents: number | null;
  budgetHighCents: number | null;
  preferredSires: string[];
  notes: string | null;
}

export interface SuggestionsResponse {
  count: number;
  hips: SearchHip[];
  hasProfile: boolean;
  currency?: string;
}

export interface ShortlistSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
}

export interface ShortlistItemHip {
  id: string;
  hipNumber: number;
  saleId: string | null;
  saleName: string | null;
  saleYear: number | null;
  sireName: string | null;
  damName: string | null;
  sex: Sex | null;
  consignorName: string | null;
  valuation: Valuation | null;
}

export interface ShortlistItem {
  hipId: string;
  note: string | null;
  hip: ShortlistItemHip;
}

export interface ShortlistDetail {
  id: string;
  name: string;
  items: ShortlistItem[];
}

export type AlertType = 'CATALOG_DROP' | 'CRITERIA_MATCH' | 'SALE_SOON';

export interface BuyerAlert {
  id: string;
  type: AlertType;
  saleId: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CalendarSale {
  id: string;
  auctionHouse: string;
  name: string;
  year: number;
  startDate: string | null;
  hipCount: number;
  upcoming: boolean;
  currency?: string;
  category?: SaleCategory;
}

// The calendar is public (no auth header needed), so it reuses request().
export function getCalendar(): Promise<CalendarSale[]> {
  return request<CalendarSale[]>('/calendar');
}

// ---------------------------------------------------------------------------
// Cross-auction comparison (Phase 4). /sires and /compare are public; cents
// are USD-normalized.
// ---------------------------------------------------------------------------

export interface SireSuggestion {
  name: string;
  count: number;
}

export interface CompareHouse {
  auctionHouse: string;
  currency: string;
  n: number;
  medianCents: number;
  avgCents: number;
  p25Cents: number;
  p75Cents: number;
  years: string | null;
}

export interface CompareResponse {
  sire: string;
  totalSold: number;
  houses: CompareHouse[];
}

export function getSires(q: string, limit = 20): Promise<SireSuggestion[]> {
  return request<SireSuggestion[]>(
    `/sires?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
}

export function getCompare(sire: string): Promise<CompareResponse> {
  return request<CompareResponse>(`/compare?sire=${encodeURIComponent(sire)}`);
}

// ---------------------------------------------------------------------------
// Notification settings (Phase 4). /me/notifications requires auth — call via
// useUser().userFetch, not the public request() helper.
// ---------------------------------------------------------------------------

export interface NotificationSettings {
  email: string;
  phone: string | null;
  notifyEmail: boolean;
  notifySms: boolean;
}

export interface NotificationSettingsInput {
  phone?: string | null;
  notifyEmail?: boolean;
  notifySms?: boolean;
}

// ---------------------------------------------------------------------------
// Secretariat — the conversational assistant. Stateless: send the short
// conversation each turn; the server runs the tool loop and returns a reply.
// ---------------------------------------------------------------------------

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantResponse {
  reply: string;
  toolsUsed: string[];
  configured?: boolean;
}

export function askSecretariat(messages: AssistantMessage[]): Promise<AssistantResponse> {
  return request<AssistantResponse>('/assistant', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
}
