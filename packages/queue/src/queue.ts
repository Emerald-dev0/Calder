/**
 * Queue abstraction — all enqueue/dequeue goes through this interface.
 * Implementations: InMemoryQueue (dev/test), RedisQueue (production via BullMQ/IORedis)
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

export interface Queue<T = unknown> {
  readonly name: string;
  enqueue(name: string, data: T, opts?: QueueOptions): Promise<string>;
  enqueueDelayed(name: string, data: T, delayMs: number, opts?: QueueOptions): Promise<string>;
  process(handler: JobHandler<T>): void;
  close(): Promise<void>;
  /** For testing: drain and process synchronously */
  drain?(): Promise<void>;
}

// ── In-Memory implementation ─────────────────────────────────

export class InMemoryQueue<T = unknown> implements Queue<T> {
  readonly name: string;
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
          // dead-letter — log and drop (worker will persist dead-letter state)
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
        }
        // else: exhausted — dropped, mirroring tryProcess dead-letter behavior
      }
    }
  }

  async close(): Promise<void> {
    this.jobs = [];
    this.handler = null;
  }

  // Test helpers
  get size(): number {
    return this.jobs.length;
  }

  get allJobs(): ReadonlyArray<QueueJob<T>> {
    return this.jobs;
  }
}

export function createQueue<T>(
  name: string,
  opts?: { maxAttempts?: number; redisUrl?: string }
): Queue<T> {
  // In production, if REDIS_URL is set and ioredis is available, we would return a Redis-backed queue.
  // For scaffold, always return InMemoryQueue — RedisQueue is a drop-in replacement.
  // To enforce the abstraction boundary at compile time, we return Queue<T>.
  const redisUrl = opts?.redisUrl ?? process.env.REDIS_URL;
  if (redisUrl && process.env.NODE_ENV === "production") {
    // Placeholder: would instantiate RedisQueue here.
    // Keeping InMemoryQueue for now to avoid hard dependency on Redis in scaffold.
  }
  return new InMemoryQueue<T>(name, opts);
}
