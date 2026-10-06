/**
 * In-process worker statistics.
 *
 * The worker's health is not "the process is up": it is "jobs are being
 * processed, and the ones that fail are failing for a reason we can see".
 * These counters feed `/ready`, `/status` and the alert rules. They reset on
 * restart by design — the durable record of failures is the `emails` table and
 * the queue's failed set.
 */
export interface LastError {
  message: string;
  code?: string;
  at: string;
  jobId?: string;
}

export interface WorkerStatsSnapshot {
  workerId: string;
  startedAt: string;
  uptimeSeconds: number;
  /** Successful provider-accepted sends. */
  sent: number;
  /** Terminal failures persisted on the email row. */
  failed: number;
  /** Recipients skipped because they are suppressed. */
  suppressed: number;
  /** Jobs that burned every attempt (dead-letter). */
  exhausted: number;
  /** Jobs whose email row vanished (should stay at zero). */
  missingRecord: number;
  /** Duplicate/stale jobs that lost the database delivery claim. */
  alreadyClaimed: number;
  /** Executions that threw and will be retried by the queue. */
  retried: number;
  lastJobAt: string | null;
  lastJobDurationMs: number | null;
  lastError: LastError | null;
  redisErrors: number;
  lastRedisErrorAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatFailures: number;
}

const state = {
  startedAt: new Date(),
  sent: 0,
  failed: 0,
  suppressed: 0,
  exhausted: 0,
  missingRecord: 0,
  alreadyClaimed: 0,
  retried: 0,
  lastJobAt: null as string | null,
  lastJobDurationMs: null as number | null,
  lastError: null as LastError | null,
  redisErrors: 0,
  lastRedisErrorAt: null as string | null,
  lastHeartbeatAt: null as string | null,
  heartbeatFailures: 0,
};

export type ProcessOutcomeLike =
  "sent" | "failed" | "suppressed" | "exhausted" | "missing_record" | "already_claimed";

export function recordJobOutcome(outcome: ProcessOutcomeLike, durationMs: number): void {
  state.lastJobAt = new Date().toISOString();
  state.lastJobDurationMs = durationMs;
  if (outcome === "sent") state.sent += 1;
  else if (outcome === "failed") state.failed += 1;
  else if (outcome === "suppressed") state.suppressed += 1;
  else if (outcome === "exhausted") state.exhausted += 1;
  else if (outcome === "missing_record") state.missingRecord += 1;
  else if (outcome === "already_claimed") state.alreadyClaimed += 1;
}

/** A job execution threw; the queue will retry it. */
export function recordJobThrow(err: unknown, jobId: string, durationMs: number): void {
  state.retried += 1;
  state.lastJobAt = new Date().toISOString();
  state.lastJobDurationMs = durationMs;
  state.lastError = {
    message: err instanceof Error ? err.message : String(err),
    code: err instanceof Error ? (err as { code?: string }).code : undefined,
    at: new Date().toISOString(),
    jobId,
  };
}

export function recordRedisError(err: unknown): void {
  state.redisErrors += 1;
  state.lastRedisErrorAt = new Date().toISOString();
  state.lastError = {
    message: err instanceof Error ? err.message : String(err),
    code: err instanceof Error ? (err as { code?: string }).code : undefined,
    at: new Date().toISOString(),
  };
}

export function recordHeartbeat(success: boolean): void {
  if (success) state.lastHeartbeatAt = new Date().toISOString();
  else state.heartbeatFailures += 1;
}

export function workerStatsSnapshot(workerId: string): WorkerStatsSnapshot {
  return {
    workerId,
    startedAt: state.startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - state.startedAt.getTime()) / 1000),
    sent: state.sent,
    failed: state.failed,
    suppressed: state.suppressed,
    exhausted: state.exhausted,
    missingRecord: state.missingRecord,
    alreadyClaimed: state.alreadyClaimed,
    retried: state.retried,
    lastJobAt: state.lastJobAt,
    lastJobDurationMs: state.lastJobDurationMs,
    lastError: state.lastError,
    redisErrors: state.redisErrors,
    lastRedisErrorAt: state.lastRedisErrorAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    heartbeatFailures: state.heartbeatFailures,
  };
}

/** Test helper. */
export function resetWorkerStats(): void {
  state.startedAt = new Date();
  state.sent = 0;
  state.failed = 0;
  state.suppressed = 0;
  state.exhausted = 0;
  state.missingRecord = 0;
  state.alreadyClaimed = 0;
  state.retried = 0;
  state.lastJobAt = null;
  state.lastJobDurationMs = null;
  state.lastError = null;
  state.redisErrors = 0;
  state.lastRedisErrorAt = null;
  state.lastHeartbeatAt = null;
  state.heartbeatFailures = 0;
}
