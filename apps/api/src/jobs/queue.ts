/**
 * BullMQ queue + Redis connection — created lazily so the API boots (and CI /
 * tests run) with no Redis present. Nothing here connects until something calls
 * getQueue()/getConnection(), which only happens when JOBS_ENABLED is set or an
 * admin explicitly enqueues a job.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAME, jobsConfig, type JobName } from './config.js';

let connection: IORedis | null = null;
let queue: Queue | null = null;

export function getConnection(): IORedis {
  if (!connection) {
    // maxRetriesPerRequest must be null for BullMQ blocking commands.
    connection = new IORedis(jobsConfig.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}

export async function enqueue(
  name: JobName,
  data: Record<string, unknown> = {},
  jobId?: string,
): Promise<void> {
  await getQueue().add(name, data, {
    jobId,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  });
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}
