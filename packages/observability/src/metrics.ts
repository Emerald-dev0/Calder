/**
 * In-process operational counters.
 *
 * These exist to feed alert evaluation, not analytics: a rolling window of
 * API status/duration samples, plus monotonic counters for the failure modes
 * that have no other home (enqueue failures, provider failures, exhausted
 * jobs). Nothing here is persisted; a restart resets it, which is correct for
 * "is this process currently unhealthy?" and documented as such.
 */

export interface RequestSample {
  at: number;
  status: number;
  durationMs: number;
}

export interface RequestMetricsSnapshot {
  requests: number;
  errors5xx: number;
  slowestMs: number;
  windowMinutes: number;
}

/** Bounded rolling window of request samples. */
export class RequestMetrics {
  private samples: RequestSample[] = [];
  private readonly maxSamples: number;

  constructor(opts: { maxSamples?: number } = {}) {
    this.maxSamples = opts.maxSamples ?? 5000;
  }

  record(status: number, durationMs: number, at: number = Date.now()): void {
    this.samples.push({ at, status, durationMs });
    if (this.samples.length > this.maxSamples) {
      // Drop the oldest half in one go rather than shifting on every write.
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  snapshot(windowMinutes = 5, now: number = Date.now()): RequestMetricsSnapshot {
    const cutoff = now - windowMinutes * 60_000;
    let requests = 0;
    let errors5xx = 0;
    let slowestMs = 0;
    for (const sample of this.samples) {
      if (sample.at < cutoff) continue;
      requests += 1;
      if (sample.status >= 500) errors5xx += 1;
      if (sample.durationMs > slowestMs) slowestMs = sample.durationMs;
    }
    return { requests, errors5xx, slowestMs, windowMinutes };
  }

  reset(): void {
    this.samples = [];
  }
}

/** Rolling counter over a configurable window (minutes). */
export class SlidingCounter {
  private events: number[] = [];
  private readonly windowMs: number;

  constructor(windowMinutes: number) {
    this.windowMs = windowMinutes * 60_000;
  }

  inc(count = 1, at: number = Date.now()): void {
    for (let i = 0; i < count; i++) this.events.push(at);
    const cutoff = at - this.windowMs;
    if (this.events.length > 0 && this.events[0]! < cutoff) {
      this.events = this.events.filter((t) => t >= cutoff);
    }
  }

  value(now: number = Date.now()): number {
    const cutoff = now - this.windowMs;
    return this.events.filter((t) => t >= cutoff).length;
  }

  reset(): void {
    this.events = [];
  }
}

// Per-process singletons. The API and the worker each own their own copy;
// alert evaluation reads whichever process is doing the evaluating.
export const apiRequestMetrics = new RequestMetrics();
export const queueEnqueueFailures = new SlidingCounter(15);
export const providerFailures = new SlidingCounter(15);
export const exhaustedJobs = new SlidingCounter(15);
