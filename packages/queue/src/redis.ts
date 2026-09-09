import { Queue as BullQueue, Worker as BullWorker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { Queue, QueueJob, QueueOptions, JobHandler } from "./queue";

/**
 * Redis-backed queue (BullMQ). Production implementation of Queue<T>.
 *
 * Retry contract (shared with InMemoryQueue): the handler decides. It rethrows
 * transient errors while attempts remain; BullMQ redelivers with exponential
 * backoff and increments attemptsMade, which surfaces as job.attempts, so
 * existing worker logic (transient/permanent/exhausted branches) works unchanged.
 * Permanent failures return normally after persisting failed state.
 */
export class RedisQueue<T = unknown> implements Queue<T> {
 readonly name: string;
 private queue: BullQueue;
 private worker: BullWorker | null = null;
 private readonly redisUrl: string;
 private readonly maxAttempts: number;
 private readonly concurrency: number;

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
 this.concurrency = opts?.concurrency ?? 5;
 this.queue = new BullQueue(backendName, {
 connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }),
 });
 this.backendName = backendName;
 }

 private readonly backendName: string;

 async enqueue(jobName: string, data: T, opts?: QueueOptions): Promise<string> {
 const job = await this.queue.add(jobName, data as Record<string, unknown>, {
 attempts: opts?.maxAttempts ?? this.maxAttempts,
 backoff: { type: "exponential", delay: 2000 },
 removeOnComplete: 1000,
 removeOnFail: 5000,
 ...(opts?.delayMs ? { delay: opts.delayMs } : {}),
 });
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
 }

 async close(): Promise<void> {
 await this.worker?.close();
 this.worker = null;
 await this.queue.close();
 }
}
