/** Queue wake-up after acceptance; delivery remains in the authenticated drain. */
import { waitUntil } from "@vercel/functions";
import { wakeDeliveryDrain } from "@calder/queue";
import { logger } from "@calder/observability";

type ExecutionCtx = { waitUntil?: (promise: Promise<unknown>) => void };

export function kickDrain(executionCtx?: ExecutionCtx): void {
  const request = wakeDeliveryDrain().then((result) => {
    if (!result.ok) logger.warn(result, "Delivery drain wake-up failed");
  });
  if (executionCtx?.waitUntil) executionCtx.waitUntil(request);
  else waitUntil(request);
  // No time-based debounce: a second enqueue may happen after the previous
  // drain already selected its batch. Dropping that wake-up strands the email.
}

/** Hono throws when no execution context was supplied by its host adapter. */
export function executionCtxOf(c: unknown): ExecutionCtx | undefined {
  try {
    const ctx = (c as { executionCtx?: ExecutionCtx }).executionCtx;
    return ctx && typeof ctx.waitUntil === "function" ? ctx : undefined;
  } catch {
    return undefined;
  }
}
