/**
 * The nightly retrain, in a process of its own.
 *
 * Retraining revalues every upcoming sale, which means loading each catalogue's
 * hips and their features into memory. Done inside the long-lived worker that
 * peak became permanent: V8 does not return a high-water mark to the OS, so the
 * worker sat at 3.8 GB after three nights (0.23 GB before) and Railway bills
 * memory by the minute — about $37/month for a peak that lasts twenty minutes.
 *
 * Running it here means the peak dies with the process. The worker hands off,
 * waits, and goes back to its 0.23 GB.
 *
 * Talks back over the fork IPC channel: `{ ok: true, summary }` or
 * `{ ok: false, error }`, then exits. Never writes the summary to stdout — the
 * worker's logs stay the worker's.
 */
import { runRetrain } from './handlers.js';

const saleId = process.argv[2] || undefined;

function send(message: unknown): void {
  // No channel when run directly (`tsx src/jobs/retrainChild.ts`), which is a
  // legitimate way to trigger a retrain by hand.
  if (process.send) process.send(message);
  else console.log(JSON.stringify(message));
}

runRetrain(saleId)
  .then((summary) => {
    send({ ok: true, summary });
    process.exit(0);
  })
  .catch((err: unknown) => {
    send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
