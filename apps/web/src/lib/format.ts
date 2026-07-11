import type { SaleCategory, Sex } from './api';
// Re-export the confidence label from the shared package so the web badge and
// Secretariat stay in lockstep on the thresholds.
export { confidenceLabel } from '@furlong/shared';

// Single source of truth for the valuation disclaimer (shown wherever an
// estimate appears). Scores pedigree + market comparables only — never physical
// conformation or veterinary condition. Informational, not advice.
export const VALUATION_DISCLAIMER =
  'Estimates score pedigree and market comparables only — not physical conformation, ' +
  'soundness, or veterinary condition. Informational, not bloodstock or financial advice.';

// One-line version for the persistent site footer.
export const FOOTER_DISCLAIMER =
  'Furlong provides data-driven estimates for information only — not bloodstock, ' +
  'veterinary, or financial advice. Always inspect a horse and consult a professional before bidding.';

/**
 * Convert a dollar amount (as typed by a buyer) to integer cents for the API.
 * Returns undefined for blank/invalid/negative input so the field is omitted.
 */
export function dollarsToCents(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const dollars = Number(trimmed.replace(/[$,]/g, ''));
  if (!Number.isFinite(dollars) || dollars < 0) return undefined;
  return Math.round(dollars * 100);
}

/** Parse a comma-separated sires field into a clean string[]. */
export function parseSires(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sexColorLabel(sex: Sex | null, color: string | null): string {
  const parts = [color, sex ? sex.toLowerCase() : null].filter(Boolean);
  return parts.join(' ');
}

const CATEGORY_LABELS: Record<SaleCategory, string> = {
  YEARLING: 'Yearling',
  BREEDING_STOCK: 'Breeding Stock',
  TWO_YEAR_OLD: '2YO',
  WEANLING: 'Weanling',
  MIXED: 'Mixed',
  OTHER: 'Other',
};

/** Human label for a sale category. */
export function categoryLabel(category: SaleCategory | null | undefined): string {
  if (!category) return '';
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Returns a short category badge label for non-yearling sales (yearling is the
 * default, so we don't badge it), or null when nothing should be shown.
 */
export function nonDefaultCategoryLabel(
  category: SaleCategory | null | undefined,
): string | null {
  if (!category || category === 'YEARLING') return null;
  return categoryLabel(category);
}

/** Returns the currency code to badge when it isn't USD, otherwise null. */
export function nonUsdCurrency(currency: string | null | undefined): string | null {
  if (!currency || currency === 'USD') return null;
  return currency;
}

