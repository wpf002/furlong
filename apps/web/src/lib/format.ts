import type { Sex } from './api';

// Single source of truth for the Phase 1 valuation disclaimer.
export const VALUATION_DISCLAIMER =
  'Estimates are based on historical averages, not a trained model (Phase 1).';

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

/** Map a 0..1 confidence into a coarse, honest label. Never invents precision. */
export function confidenceLabel(confidence: number): 'High' | 'Medium' | 'Low' {
  if (confidence >= 0.66) return 'High';
  if (confidence >= 0.33) return 'Medium';
  return 'Low';
}
