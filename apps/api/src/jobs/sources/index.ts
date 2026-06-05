import type { SourceAdapter } from './types.js';
import { fasigTiptonAdapter } from './fasigTipton.js';

/**
 * Registry of source adapters. Fasig-Tipton is the reference implementation;
 * Keeneland / Tattersalls slot in by implementing SourceAdapter (their Python
 * fetchers in services/ml/scripts are the spec). The discovery/ingest jobs are
 * house-agnostic and iterate whatever is registered here.
 */
export const sourceAdapters: SourceAdapter[] = [fasigTiptonAdapter];

export function getAdapter(key: string): SourceAdapter | undefined {
  return sourceAdapters.find((a) => a.key === key);
}

export type { SourceAdapter, DiscoveredSale, FetchedSale } from './types.js';
