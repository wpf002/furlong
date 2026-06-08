import type { SourceAdapter } from './types.js';
import { fasigTiptonAdapter } from './fasigTipton.js';
import { keenelandAdapter } from './keeneland.js';
import { tattersallsAdapter } from './tattersalls.js';
import { obsAdapter } from './obs.js';

/**
 * Registry of source adapters. Each house implements SourceAdapter (its Python
 * fetcher in services/ml/scripts is the spec). The discovery/ingest jobs are
 * house-agnostic and iterate whatever is registered here.
 */
export const sourceAdapters: SourceAdapter[] = [
  fasigTiptonAdapter,
  keenelandAdapter,
  tattersallsAdapter,
  obsAdapter,
];

export function getAdapter(key: string): SourceAdapter | undefined {
  return sourceAdapters.find((a) => a.key === key);
}

export type { SourceAdapter, DiscoveredSale, FetchedSale } from './types.js';
