/**
 * The worker restarts itself when it gets heavy. Two ways that can go wrong and
 * both are worse than the memory: never recycling (the $27/month drift), or
 * recycling immediately on every boot, which is a restart loop that never
 * drains the queue.
 */
import { describe, expect, it } from 'vitest';
import { shouldRecycle, containerMemoryBytes } from './recycle.js';

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

describe('containerMemoryBytes', () => {
  it('reads cgroup v2 first — that is the number Railway bills', () => {
    const read = (p: string) => (p === '/sys/fs/cgroup/memory.current' ? 3_400_000_000 : null);
    expect(containerMemoryBytes(read)).toBe(3_400_000_000);
  });

  it('falls back to cgroup v1', () => {
    const read = (p: string) => (p === '/sys/fs/cgroup/memory/memory.usage_in_bytes' ? 2_000_000_000 : null);
    expect(containerMemoryBytes(read)).toBe(2_000_000_000);
  });

  // Within 25 MB of this process, not exactly it: RSS moves between the call
  // under test and the one in the assertion.
  const nearOwnRss = (bytes: number) =>
    Math.abs(bytes - process.memoryUsage().rss) < 25 * MB;

  it('falls back to this process off-container, where nothing bills a cgroup', () => {
    expect(nearOwnRss(containerMemoryBytes(() => null))).toBe(true);
  });

  it('ignores an unreadable or nonsense cgroup value', () => {
    expect(nearOwnRss(containerMemoryBytes(() => 0))).toBe(true);
    expect(nearOwnRss(containerMemoryBytes(() => -1))).toBe(true);
    expect(nearOwnRss(containerMemoryBytes(() => Number.NaN))).toBe(true);
  });

  it('catches the bug that shipped: a quiet heap inside a heavy container', () => {
    // 3.19 GB billed, heap well under the line. The old check read the heap and
    // never fired for seven days.
    const container = 3.19 * 1024 ** 3;
    expect(shouldRecycle({ rssBytes: container, uptimeMs: 60 * 60 * 1000, ...base })).toBe(true);
    expect(shouldRecycle({ rssBytes: 400 * MB, uptimeMs: 60 * 60 * 1000, ...base })).toBe(false);
  });
});
