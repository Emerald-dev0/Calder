import { Queue as BullQueue, Worker as BullWorker, type Job } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "@calder/config";
import type { Queue, QueueJob, QueueMetrics, QueueOptions, JobHandler } from "./queue.js";

/**
 * Redis-backed queue (BullMQ). Production implementation of Queue<T>.
 *
 * Two connections with deliberately different failure postures:
 *
 *  - Producer (`queue.add`, metrics): fail fast. `enableOfflineQueue: false`
 *    plus a bounded per-command timeout means an unreachable Redis produces an
 *    error in milliseconds instead of a request that hangs until the client
 *    gives up. The API's durable Postgres row is the source of truth, so a fast
 *    failure is always the better outcome than a hanging request.
 *  - Consumer (Worker): reconnect forever (`maxRetriesPerRequest: null`, which
 *    BullMQ requires). A worker should sit and wait for Redis to come back —
 *    it is a long-lived process, not a user-facing request.
 *
 * Retry contract (shared with InMemoryQueue): the handler decides. It rethrows
 * transient errors while attempts remain; BullMQ redelivers with exponential
 * backoff and increments attemptsMade, which surfaces as job.attempts, so
 * existing worker logic (transient/permanent/exhausted branches) works unchanged.
 * Permanent failures return normally after persisting failed state.
 */
export class RedisQueue<T = unknown> implements Queue<T> {
  readonly name: string;
  readonly driver = "redis" as const;
  private queue: BullQueue;
  private worker: BullWorker | null = null;
  private producer: IORedis;
  private readonly redisUrl: string;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly backendName: string;
  /** Observability hooks, set by the owning process (worker). */
  private errorListener: ((err: Error) => void) | null = null;

  constructor(
    name: string,
    redisUrl: string,
    opts?: { maxAttempts?: number; concurrency?: number }
  ) {
    // BullMQ forbids ":" in queue names, sanitize for the backend only.
    // The logical Queue.name (used in logs/ids) keeps the canonical form.
    const backendName = name.replace(/:/g, "-");
    this.name = name;
    this.redisUrl = redisUrl;
    this.maxAttempts = opts?.maxAttempts ?? 5;
    this.concurrency = opts?.concurrency ?? getConfig().WORKER_CONCURRENCY;
    this.backendName = backendName;

    const { REDIS_CONNECT_TIMEOUT_MS } = getConfig();
    this.producer = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      lazyConnect: false,
    });
    // An ioredis 'error' event with no listener kills the process. The queue
    // has to be able to report "Redis is down" as data, not as a crash.
    this.producer.on("error", (err) => this.emitError(err));

    this.queue = new BullQueue(backendName, { connection: this.producer });
    // BullMQ re-emits connection failures on the Queue object; an 'error'
    // event with no listener is an uncaught exception in Node.
    this.queue.on("error", (err) => this.emitError(err));
  }

  /** Register a listener for backend errors (reported through worker health). */
  onError(listener: (err: Error) => void): void {
    this.errorListener = listener;
  }

  private emitError(err: Error): void {
    if (this.errorListener) this.errorListener(err);
    else {
      // Never silent: an unconsumed Redis error is still logged, with the
      // target host only (no credentials).
      console.error(`[queue:${this.name}] redis error: ${err.message}`);
    }
  }

  async enqueue(jobName: string, data: T, opts?: QueueOptions): Promise<string> {
    const { REDIS_ENQUEUE_TIMEOUT_MS } = getConfig();
    const add = this.queue.add(jobName, data as Record<string, unknown>, {
      attempts: opts?.maxAttempts ?? this.maxAttempts,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...(opts?.delayMs ? { delay: opts.delayMs } : {}),
    });
    // A half-open connection can leave a command in flight indefinitely even
    // with enableOfflineQueue disabled. Bound every enqueue; the caller's
    // durable record makes a failed enqueue recoverable, a hung one is not.
    const job = await withTimeout(add, REDIS_ENQUEUE_TIMEOUT_MS, `enqueue ${this.name}/${jobName}`);
    return job.id ?? `${this.name}:${Date.now()}`;
  }

  async enqueueDelayed(
    jobName: string,
    data: T,
    delayMs: number,
    opts?: QueueOptions
  ): Promise<string> {
    return this.enqueue(jobName, data, { ...opts, delayMs });
  }

  process(handler: JobHandler<T>): void {
    if (this.worker) return;
    this.worker = new BullWorker(
      this.backendName,
      async (job: Job) => {
        const adapted: QueueJob<T> = {
          id: job.id ?? "unknown",
          name: job.name,
          data: job.data as T,
          attempts: job.attemptsMade,
          maxAttempts: typeof job.opts.attempts === "number" ? job.opts.attempts : this.maxAttempts,
          createdAt: new Date(job.timestamp),
        };
        await handler(adapted);
      },
      {
        connection: new IORedis(this.redisUrl, { maxRetriesPerRequest: null }),
        concurrency: this.concurrency,
      }
    );
    // Without this handler a Redis blip raises an unhandled 'error' event and
    // takes the worker process down with it.
    this.worker.on("error", (err) => this.emitError(err));
    this.worker.on("failed", (job, err) => {
      this.emitError(
        Object.assign(new Error(`job ${job?.id ?? "unknown"} failed: ${err.message}`), {
          code: "job_failed",
        })
      );
    });
  }

  /** Job counts straight from Redis. Throws when Redis is unreachable. */
  async metrics(): Promise<QueueMetrics> {
    const { REDIS_ENQUEUE_TIMEOUT_MS } = getConfig();
    const counts = await withTimeout(
      this.queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      REDIS_ENQUEUE_TIMEOUT_MS,
      `metrics ${this.name}`
    );
    // Oldest waiting job: `asc=true` sorts by insertion order.
    const oldest = await withTimeout(
      this.queue.getJobs(["waiting"], 0, 0, true),
      REDIS_ENQUEUE_TIMEOUT_MS,
      `oldest job ${this.name}`
    );
    const oldestTimestamp = oldest[0]?.timestamp;
    return {
      name: this.name,
      driver: "redis",
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      oldestWaitingAgeSeconds:
        typeof oldestTimestamp === "number"
          ? Math.round((Date.now() - oldestTimestamp) / 1000)
          : null,
    };
  }

  /** Cheap round trip used by readiness checks. Throws on failure. */
  async ping(): Promise<void> {
    const { REDIS_ENQUEUE_TIMEOUT_MS } = getConfig();
    const reply = await withTimeout(
      this.producer.ping(),
      REDIS_ENQUEUE_TIMEOUT_MS,
      `ping ${this.name}`
    );
    if (reply !== "PONG") throw new Error(`unexpected PING reply: ${String(reply)}`);
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
    // close() on BullMQ's queue does not necessarily close an injected
    // connection; disconnect explicitly so tests and shutdown do not leak.
    try {
      this.producer.disconnect();
    } catch {
      // already closed
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`redis command timed out after ${ms}ms (${label})`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
