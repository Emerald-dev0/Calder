import { RedisQueue } from "./redis.js";
import { getConfig, getRedisUrl, isHostedEnv, getDeployEnv } from "@calder/config";

/**
 * Queue abstraction, all enqueue/dequeue goes through this interface.
 * Implementations: InMemoryQueue (tests, single-process dev), RedisQueue (production via BullMQ/IORedis)
 */

export interface QueueJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

export interface QueueOptions {
  maxAttempts?: number;
  delayMs?: number;
}

export type JobHandler<T> = (job: QueueJob<T>) => Promise<void>;

/** Which backend is actually serving a queue. Reported by health/status endpoints. */
export type QueueDriver = "redis" | "memory";

/** Operational snapshot of one queue. Fields are counts BullMQ itself keeps. */
export interface QueueMetrics {
  name: string;
  driver: QueueDriver;
  /** Enqueued, not yet picked up by a worker. */
  waiting: number;
  /** Currently being processed. */
  active: number;
  /** Scheduled/delayed (retries with backoff, future scheduled sends). */
  delayed: number;
  /** Exhausted jobs retained by the backend: the dead-letter pool. */
  failed: number;
  /** Recently completed (retention-limited, informational only). */
  completed: number;
  /** Age of the oldest waiting job; null when the queue is empty. */
  oldestWaitingAgeSeconds: number | null;
}

export interface Queue<T = unknown> {
  readonly name: string;
  readonly driver: QueueDriver;
  enqueue(name: string, data: T, opts?: QueueOptions): Promise<string>;
  enqueueDelayed(name: string, data: T, delayMs: number, opts?: QueueOptions): Promise<string>;
  process(handler: JobHandler<T>): void;
  close(): Promise<void>;
  /** For testing: drain and process synchronously */
  drain?(): Promise<void>;
  /** For health/alert evaluation. Throws when the backend is unreachable. */
  metrics?(): Promise<QueueMetrics>;
}

/**
 * Raised when a durable queue was required but could not be constructed.
 * Deliberately not caught anywhere in the sending path: a process that cannot
 * enqueue durable work must fail loudly, never degrade silently.
 */
export class QueueConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueConfigurationError";
  }
}

// ── In-Memory implementation ─────────────────────────────────

export class InMemoryQueue<T = unknown> implements Queue<T> {
  readonly name: string;
  readonly driver = "memory" as const;
  private jobs: Array<QueueJob<T> & { delayUntil?: number; handler?: JobHandler<T> }> = [];
  private handler: JobHandler<T> | null = null;
  private maxAttemptsDefault: number;
  private idSeq = 0;

  constructor(name: string, opts?: { maxAttempts?: number }) {
    this.name = name;
    this.maxAttemptsDefault = opts?.maxAttempts ?? 3;
  }

  async enqueue(name: string, data: T, opts?: QueueOptions): Promise<string> {
    const id = `${this.name}:${++this.idSeq}:${Date.now()}`;
    const job: QueueJob<T> & { delayUntil?: number } = {
      id,
      name,
      data,
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? this.maxAttemptsDefault,
      createdAt: new Date(),
      delayUntil: opts?.delayMs ? Date.now() + opts.delayMs : undefined,
    };
    this.jobs.push(job);
    // If handler exists, try immediate processing (next tick)
    if (this.handler) setImmediate(() => this.tryProcess());
    return id;
  }

  async enqueueDelayed(
    name: string,
    data: T,
    delayMs: number,
    opts?: QueueOptions
  ): Promise<string> {
    return this.enqueue(name, data, { ...opts, delayMs });
  }

  process(handler: JobHandler<T>): void {
    this.handler = handler;
    // kick off processing
    setImmediate(() => this.tryProcess());
  }

  private async tryProcess(): Promise<void> {
    if (!this.handler) return;
    const now = Date.now();
    const ready = this.jobs.filter((j) => !j.delayUntil || j.delayUntil <= now);
    // remove ready from queue before processing
    this.jobs = this.jobs.filter((j) => j.delayUntil !== undefined && j.delayUntil > now);

    for (const job of ready) {
      try {
        await this.handler(job);
      } catch (err) {
        job.attempts += 1;
        if (job.attempts < job.maxAttempts) {
          // re-enqueue with backoff (simple exponential)
          const backoff = Math.min(1000 * 2 ** job.attempts, 30_000);
          job.delayUntil = Date.now() + backoff;
          this.jobs.push(job);
        } else {
          // dead-letter, log and drop (worker will persist dead-letter state)
          this.deadLettered++;
          console.error(
            `[queue:${this.name}] job ${job.id} exhausted after ${job.attempts} attempts`,
            err
          );
        }
      }
    }

    // If there are delayed jobs, schedule next check
    if (this.jobs.length > 0) {
      const nextDelay = Math.min(
        ...this.jobs.map((j) => (j.delayUntil ?? now) - now).filter((d) => d > 0)
      );
      if (nextDelay > 0 && nextDelay !== Infinity) {
        setTimeout(() => this.tryProcess(), Math.min(nextDelay, 1000));
      }
    }
  }

  async drain(): Promise<void> {
    if (!this.handler) return;
    // Process all ready jobs synchronously, honoring maxAttempts
    // (same retry contract as tryProcess, without the backoff delay).
    const pending = [...this.jobs];
    this.jobs = [];
    while (pending.length > 0) {
      const job = pending.shift();
      if (!job) break;
      if (job.delayUntil && job.delayUntil > Date.now()) {
        this.jobs.push(job);
        continue;
      }
      try {
        await this.handler(job);
      } catch {
        job.attempts += 1;
        if (job.attempts < job.maxAttempts) {
          pending.push(job);
        } else {
          this.deadLettered++;
        }
        // else: exhausted, dropped, mirroring tryProcess dead-letter behavior
      }
    }
  }

  async close(): Promise<void> {
    this.jobs = [];
    this.handler = null;
  }

  /** Job counts for this process only. Same shape as RedisQueue.metrics(). */
  async metrics(): Promise<QueueMetrics> {
    const now = Date.now();
    const waiting = this.jobs.filter((j) => !j.delayUntil || j.delayUntil <= now);
    const delayed = this.jobs.filter((j) => j.delayUntil !== undefined && j.delayUntil > now);
    const oldest = waiting.reduce<number | null>(
      (min, j) => (min === null || j.createdAt.getTime() < min ? j.createdAt.getTime() : min),
      null
    );
    return {
      name: this.name,
      driver: "memory",
      waiting: waiting.length,
      active: 0,
      delayed: delayed.length,
      failed: this.deadLettered,
      completed: this.completed,
      oldestWaitingAgeSeconds: oldest === null ? null : Math.round((now - oldest) / 1000),
    };
  }

  // Test helpers
  private deadLettered = 0;
  private completed = 0;

  get size(): number {
    return this.jobs.length;
  }

  get allJobs(): ReadonlyArray<QueueJob<T>> {
    return this.jobs;
  }
}

const redisInstances = new Map<string, RedisQueue<unknown>>();

let warnedMemoryQueue = false;

function warnMemoryQueueOnce(): void {
  if (warnedMemoryQueue) return;
  warnedMemoryQueue = true;
  // Intentionally console: @calder/queue must not depend on @calder/observability
  // (observability is a leaf package). Callers log the resolved driver at boot.
  console.warn(
    `[queue] REDIS_URL is unset and ${getDeployEnv()} is not a hosted environment: ` +
      "jobs run on the in-process queue. Retries and delayed sends do not survive a restart. " +
      "Set REDIS_URL for durable queueing."
  );
}

/**
 * Shared Redis instances per queue name. A new BullMQ Queue object opens its
 * own connection, call sites like per-job webhook enqueueing must reuse
 * instances, never mint connections per call.
 */
function sharedRedisQueue<T>(
  name: string,
  redisUrl: string,
  opts?: { maxAttempts?: number; concurrency?: number }
): Queue<T> {
  const cacheKey = `${name}|${redisUrl}|${opts?.maxAttempts ?? ""}|${opts?.concurrency ?? ""}`;
  const existing = redisInstances.get(cacheKey);
  if (existing) return existing as RedisQueue<T>;
  const created = new RedisQueue<T>(name, redisUrl, opts);
  redisInstances.set(cacheKey, created as unknown as RedisQueue<unknown>);
  return created;
}

/** For tests: drop cached Redis instances. */
export function resetSharedQueues(): void {
  redisInstances.clear();
  warnedMemoryQueue = false;
}

export interface CreateQueueOptions {
  maxAttempts?: number;
  concurrency?: number;
  /** Explicit URL (tests, multi-tenant workers). Defaults to REDIS_URL. */
  redisUrl?: string;
}

/**
 * Resolve the queue backend for this process.
 *
 * Redis when a URL is configured; the in-process queue only in development
 * and test. In staging and production an unset REDIS_URL is a configuration
 * error: the process refuses to construct a queue it cannot honour, instead of
 * running on memory and silently losing durability. There is deliberately no
 * escape hatch in hosted environments.
 */
export function createQueue<T>(name: string, opts?: CreateQueueOptions): Queue<T> {
  const redisUrl = opts?.redisUrl ?? getRedisUrl();
  if (redisUrl) {
    return sharedRedisQueue<T>(name, redisUrl, opts);
  }
  if (isHostedEnv()) {
    throw new QueueConfigurationError(
      `Refusing to create queue "${name}" without REDIS_URL in the ${getDeployEnv()} environment. ` +
        "The in-process queue is not durable and is never used in staging or production. " +
        "Set REDIS_URL (redis:// or rediss://) on this deployment."
    );
  }
  warnMemoryQueueOnce();
  return new InMemoryQueue<T>(name, opts);
}

/** Queue names used by Calder, in one place so alerts/health can enumerate them. */
export const QUEUE_NAMES = {
  emailSend: "email:send",
  webhookDeliver: "webhook:deliver",
} as const;

/**
 * True when this process will construct Redis-backed queues.
 * Used by readiness checks to decide whether a metric must be reported.
 */
export function queueDriverForThisProcess(): QueueDriver {
  return getRedisUrl() ? "redis" : "memory";
}

/** Re-exported so callers can build the same message the factory would throw. */
export function redisRequiredMessage(name: string): string {
  const config = getConfig();
  return (
    `Queue "${name}" needs REDIS_URL in ${getDeployEnv()} ` +
    `(NODE_ENV=${config.NODE_ENV}); see docs/OPERATIONS.md § Redis requirement matrix.`
  );
}
