/**
 * The worker restarts itself when it gets heavy. Two ways that can go wrong and
 * both are worse than the memory: never recycling (the $27/month drift), or
 * recycling immediately on every boot, which is a restart loop that never
 * drains the queue.
 */
import { describe, expect, it } from 'vitest';
import { shouldRecycle } from './recycle.js';

const MB = 1024 * 1024;
const MIN = 60 * 1000;
const base = { thresholdMb: 900, minUptimeMs: 10 * MIN };

describe('shouldRecycle', () => {
  it('leaves a fresh worker alone', () => {
    expect(shouldRecycle({ rssBytes: 240 * MB, uptimeMs: 60 * MIN, ...base })).toBe(false);
  });

  it('recycles once the process is heavy', () => {
    expect(shouldRecycle({ rssBytes: 1400 * MB, uptimeMs: 60 * MIN, ...base })).toBe(true);
  });

  it('will not recycle in the first minutes, however heavy', () => {
    // A boot already over the line means the threshold is wrong, and restarting
    // on the first job would loop forever without doing any work.
    expect(shouldRecycle({ rssBytes: 4000 * MB, uptimeMs: 30 * 1000, ...base })).toBe(false);
  });

  it('holds at exactly the threshold and goes one byte over it', () => {
    expect(shouldRecycle({ rssBytes: 900 * MB, uptimeMs: 60 * MIN, ...base })).toBe(false);
    expect(shouldRecycle({ rssBytes: 900 * MB + 1, uptimeMs: 60 * MIN, ...base })).toBe(true);
  });

  it('can be switched off entirely', () => {
    expect(shouldRecycle({ rssBytes: 8000 * MB, uptimeMs: 60 * MIN, thresholdMb: 0 })).toBe(false);
  });

  it('honours a threshold raised or lowered for one environment', () => {
    expect(shouldRecycle({ rssBytes: 600 * MB, uptimeMs: 60 * MIN, thresholdMb: 500, minUptimeMs: 0 })).toBe(true);
    expect(shouldRecycle({ rssBytes: 3000 * MB, uptimeMs: 60 * MIN, thresholdMb: 3500, minUptimeMs: 0 })).toBe(false);
  });
});
