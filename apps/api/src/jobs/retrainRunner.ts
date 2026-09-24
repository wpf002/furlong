/**
 * Hands the retrain to a child process and waits for its summary.
 *
 * Revaluing every upcoming sale peaks at gigabytes, and V8 never returns a peak
 * to the OS: run inside the long-lived worker it left the process resident at
 * 3.8 GB (0.23 GB before), billed around the clock for twenty minutes of work.
 * A child's memory leaves with the child.
 */
import { fork } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A retrain that hangs must not pin its memory forever. Generous: a real run
 *  is ~20 minutes, and the ML /train call alone allows 10. */
const RETRAIN_TIMEOUT_MS = Number(process.env.RETRAIN_TIMEOUT_MS ?? 60 * 60 * 1000);

/**
 * Run the retrain in a child process and wait for its summary.
 *
 * Revaluing every upcoming sale peaks at gigabytes, and V8 never hands a peak
 * back to the OS — done in-process it left the worker resident at 3.8 GB, billed
 * around the clock for twenty minutes of work. A child's memory leaves with it.
 *
 * The child is the sibling file, in whatever form this one is running (`.ts`
 * under tsx in production, `.js` if built), and inherits execArgv so the tsx
 * loader carries over.
 */
export function retrainChildPath(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), `retrainChild${extname(here)}`);
}

export function runRetrainInChild(saleId?: string, childPath = retrainChildPath()): Promise<unknown> {
  const child = childPath;

  return new Promise((resolve, reject) => {
    const proc = fork(child, saleId ? [saleId] : [], { execArgv: process.execArgv });
    let reply: { ok?: boolean; summary?: unknown; error?: string } | null = null;
    let done = false;

    const timer = setTimeout(() => {
      proc.kill('SIGKILL'); // the exit handler below turns this into a failure
    }, RETRAIN_TIMEOUT_MS);

    const finish = (err: Error | null, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    proc.on('message', (m) => {
      reply = m as typeof reply;
    });
    proc.on('error', (err) => finish(err));
    proc.on('exit', (code, signal) => {
      if (reply?.ok) return finish(null, reply.summary);
      if (reply?.error) return finish(new Error(reply.error));
      finish(new Error(`retrain child exited ${signal ? `on ${signal}` : `with code ${code}`} and said nothing`));
    });
  });
}

