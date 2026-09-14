/**
 * Queue wake-up.
 *
 * On serverless hosts the queue has no long-running consumer: the drain runs
 * on a schedule. A daily schedule is fine for retries and wrong for a
 * confirmation email someone is waiting on, so after a send is accepted we
 * nudge the drain immediately and let the scheduled run stay as a safety net
 * for retries, delayed sends and anything the nudge missed.
 *
 * Deliberate properties:
 * - never blocks the response (the 202 is already on its way)
 * - debounced per process, so a batch of 100 sends is one wake-up
 * - authenticated with CRON_SECRET, never a spoofed platform header
 * - failure is logged and otherwise ignored: the scheduled drain still runs
 */
import { logger } from "@calder/observability";

/** At most one wake-up per process per window; the drain handles batches. */
const KICK_DEBOUNCE_MS = 1500;
let lastKickAt = 0;
let warnedMissingSecret = false;

type ExecutionCtx = { waitUntil?: (promise: Promise<unknown>) => void };

function selfUrl(): string | null {
  const url = process.env.API_URL ?? process.env.APP_URL;
  if (!url) return null;
  return `${url.replace(/\/$/, "")}/v1/cron/drain`;
}

export function kickDrain(executionCtx?: ExecutionCtx): void {
  const now = Date.now();
  if (now - lastKickAt < KICK_DEBOUNCE_MS) return;
  lastKickAt = now;

  const secret = process.env.CRON_SECRET ?? process.env.ADMIN_API_KEY ?? "";
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      logger.warn(
        "CRON_SECRET is not set: accepted sends wait for the scheduled drain instead of " +
          "delivering immediately. Set CRON_SECRET before launch."
      );
    }
    return;
  }

  const url = selfUrl();
  if (!url) {
    logger.warn("API_URL is not set: cannot wake the delivery drain after enqueue.");
    return;
  }

  const request = fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      "x-calder-kick": "1",
    },
  })
    .then((res) => {
      if (!res.ok) {
        logger.warn({ status: res.status }, "Delivery drain wake-up returned non-2xx");
      }
    })
    .catch((err) => {
      // The scheduled drain is the backstop; a failed nudge is not a user-facing error.
      logger.warn({ err }, "Delivery drain wake-up failed");
    });

  if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(request);
  }
}

/** Best-effort access to a Hono execution context (absent on long-lived servers). */
export function executionCtxOf(c: unknown): ExecutionCtx | undefined {
  try {
    const ctx = (c as { executionCtx?: ExecutionCtx }).executionCtx;
    return ctx && typeof ctx.waitUntil === "function" ? ctx : undefined;
  } catch {
    return undefined;
  }
}
