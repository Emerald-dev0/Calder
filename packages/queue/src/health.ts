import IORedis from "ioredis";
import type { Queue, QueueMetrics } from "./queue.js";

/**
 * Worker liveness and queue health primitives.
 *
 * "The worker is running" is not observable from the queue alone: an empty
 * queue with a dead consumer looks identical to an empty queue with a healthy
 * one. Each worker therefore publishes a heartbeat with a TTL; a stale or
 * missing heartbeat is the signal that no consumer is alive, and it survives
 * Redis restarts (the key disappears, which is exactly the alarm).
 */

export const WORKER_HEARTBEAT_PREFIX = "calder:worker:heartbeat:";

export interface WorkerHeartbeat {
  workerId: string;
  /** ISO timestamps, written by the worker process. */
  startedAt: string;
  updatedAt: string;
  /** Jobs completed / failed since this process started. */
  processed: number;
  failed: number;
  /** Which queues this worker consumes. */
  queues: string[];
  /** "redis" in hosted environments; "memory" only in local dev/tests. */
  driver: string;
}

export interface HeartbeatReadResult {
  ok: boolean;
  detail: string;
  heartbeats: WorkerHeartbeat[];
}

/** Writes/reads worker heartbeats. One instance per process is enough. */
export class WorkerHeartbeatStore {
  private client: IORedis;
  private readonly ttlSeconds: number;

  constructor(redisUrl: string, opts?: { ttlSeconds?: number }) {
    this.ttlSeconds = opts?.ttlSeconds ?? 180;
    this.client = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    this.client.on("error", () => {
      // Errors are surfaced by the callers (write returns false, read returns
      // ok:false); never let an unhandled 'error' event kill the process.
    });
  }

  /** Best-effort: a failed heartbeat is reported, never thrown. */
  async write(heartbeat: WorkerHeartbeat): Promise<boolean> {
    try {
      await this.client.connect().catch(() => undefined);
      const key = `${WORKER_HEARTBEAT_PREFIX}${heartbeat.workerId}`;
      await this.client.set(key, JSON.stringify(heartbeat), "EX", this.ttlSeconds);
      return true;
    } catch {
      return false;
    }
  }

  /** Reads every live worker heartbeat. Missing keys simply do not appear. */
  async read(): Promise<HeartbeatReadResult> {
    try {
      await this.client.connect().catch(() => undefined);
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await this.client.scan(
          cursor,
          "MATCH",
          `${WORKER_HEARTBEAT_PREFIX}*`,
          "COUNT",
          100
        );
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0");

      const heartbeats: WorkerHeartbeat[] = [];
      if (keys.length > 0) {
        const values = await this.client.mget(...keys);
        for (const raw of values) {
          if (!raw) continue;
          try {
            heartbeats.push(JSON.parse(raw) as WorkerHeartbeat);
          } catch {
            // A malformed heartbeat is ignored; its absence shows up as stale.
          }
        }
      }
      return { ok: true, detail: `${heartbeats.length} live worker(s)`, heartbeats };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : "heartbeat read failed",
        heartbeats: [],
      };
    }
  }

  async clear(workerId: string): Promise<void> {
    try {
      await this.client.del(`${WORKER_HEARTBEAT_PREFIX}${workerId}`);
    } catch {
      // Shutdown path: nothing useful to do if Redis is already gone.
    }
  }

  close(): void {
    try {
      this.client.disconnect();
    } catch {
      // already closed
    }
  }
}

export interface QueueHealth {
  /** Per-queue metrics; queues whose backend was unreachable are reported in `errors`. */
  metrics: QueueMetrics[];
  errors: Array<{ name: string; error: string }>;
}

/** Collect metrics for every queue, tolerating individual failures. */
export async function collectQueueHealth(queues: Queue<unknown>[]): Promise<QueueHealth> {
  const metrics: QueueMetrics[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  for (const queue of queues) {
    if (!queue.metrics) continue;
    try {
      metrics.push(await queue.metrics());
    } catch (err) {
      errors.push({ name: queue.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { metrics, errors };
}

/** True when any heartbeat is newer than `staleSeconds`. */
export function hasFreshHeartbeat(
  heartbeats: WorkerHeartbeat[],
  staleSeconds: number,
  now: number = Date.now()
): boolean {
  return heartbeats.some((hb) => {
    const updated = Date.parse(hb.updatedAt);
    return Number.isFinite(updated) && now - updated <= staleSeconds * 1000;
  });
}
