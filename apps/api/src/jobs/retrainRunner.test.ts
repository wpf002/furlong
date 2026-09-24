/**
 * The retrain moved into a child process to stop a twenty-minute memory peak
 * being billed around the clock. That only works if the worker still learns
 * what happened: a summary must come back, a failure must fail the job rather
 * than resolve quietly, and a child that dies without speaking must not leave
 * the job hanging forever.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRetrainInChild, retrainChildPath } from './retrainRunner.js';

const dir = mkdtempSync(join(tmpdir(), 'retrain-child-'));

function fixture(name: string, body: string): string {
  const p = join(dir, `${name}.mjs`);
  writeFileSync(p, body);
  return p;
}

describe('the retrain child', () => {
  it('returns the summary it sends back', async () => {
    const child = fixture(
      'ok',
      `process.send({ ok: true, summary: { modelVersion: 'v9', valuedSales: 2, valuedHips: 40 } });
       process.exit(0);`,
    );
    await expect(runRetrainInChild(undefined, child)).resolves.toEqual({
      modelVersion: 'v9',
      valuedSales: 2,
      valuedHips: 40,
    });
  });

  it('passes the sale id through to the child', async () => {
    const child = fixture(
      'arg',
      `process.send({ ok: true, summary: { sawSaleId: process.argv[2] ?? null } });
       process.exit(0);`,
    );
    await expect(runRetrainInChild('sale_123', child)).resolves.toEqual({ sawSaleId: 'sale_123' });
  });

  it('fails the job when the child reports an error', async () => {
    const child = fixture(
      'err',
      `process.send({ ok: false, error: 'ML /train failed: 500' });
       process.exit(1);`,
    );
    await expect(runRetrainInChild(undefined, child)).rejects.toThrow('ML /train failed: 500');
  });

  it('fails the job when the child dies without saying anything', async () => {
    const child = fixture('silent', `process.exit(3);`);
    await expect(runRetrainInChild(undefined, child)).rejects.toThrow(/code 3/);
  });

  it('fails the job when the child cannot be started at all', async () => {
    await expect(runRetrainInChild(undefined, join(dir, 'missing.mjs'))).rejects.toThrow();
  });

  it('looks for the child beside itself, in the form it is running', () => {
    const p = retrainChildPath();
    expect(p).toMatch(/retrainChild\.(ts|js)$/);
    // Under tsx the worker runs .ts and so must its child; built, both are .js.
    expect(extname(p)).toBe(extname(new URL(import.meta.url).pathname).replace('.test', ''));
  });
});
