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

export const ParseCatalogResponseSchema = z.object({
  auctionHouse: z.enum(['KEENELAND', 'FASIG_TIPTON', 'TATTERSALLS', 'GOFFS', 'OBS', 'INGLIS']),
  saleName: z.string(),
  year: z.number().int(),
  hips: z.array(CatalogHipSchema),
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

// Buyer search query coming from the web app.
export const SearchQuerySchema = z.object({
  saleId: z.string(),
  budgetLowCents: z.number().int().nonnegative().optional(),
  budgetHighCents: z.number().int().positive().optional(),
  preferredSires: z.array(z.string()).optional(),
  hiddenGemsOnly: z.boolean().optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
