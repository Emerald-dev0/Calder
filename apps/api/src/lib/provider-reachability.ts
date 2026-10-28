import { safeErrorName } from "@calder/observability";

/**
 * Is the email provider actually reachable, or merely configured?
 *
 * This exists because `/ready` said `email_provider: { state: "ok",
 * detail: "driver=ses" }` for days while every send from the deployment was
 * failing. `resolveEmailProvider` only checks that `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` are non-empty strings — it never calls AWS. So the
 * endpoint reported "configured" and an operator read it as "working".
 *
 * A config check cannot answer "can we deliver mail". Only a request can. So
 * this sends the cheapest real call the SES API has (`GetAccount`) and reports
 * what came back.
 *
 * Three properties matter, because a health check that lies is worse than none:
 *
 * - **Bounded.** A provider that hangs must not hang `/ready`. The probe is
 *   raced against a timeout; the losing request is aborted so it does not leak.
 * - **Cached.** Health monitors poll. One call per minute per process is enough
 *   to notice an outage and cheap enough to run forever.
 * - **Log-safe.** A provider error message can contain recipient addresses,
 *   ARNs and account ids, so only the error's *class* is reported — the same
 *   rule (`safeErrorName`) the delivery rows follow.
 */

export type ReachabilityState = "ok" | "degraded" | "skipped";

export interface ReachabilityResult {
  state: ReachabilityState;
  /** One line, safe to return from a public endpoint. */
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_CACHE_TTL_MS = 60_000;

/**
 * Race `probe()` against a timeout.
 *
 * The abort signal is passed through so a real HTTP client stops work rather
 * than completing into a discarded promise. `probe` may ignore it — the race is
 * still correct; the abort only prevents the leak.
 */
export async function probeWithTimeout(
  probe: (signal: AbortSignal) => Promise<unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ReachabilityResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
    // Never hold the process open for a probe.
    if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
  });

  try {
    const started = Date.now();
    const outcome = await Promise.race([
      probe(controller.signal).then((value) => ({ ok: true as const, value })),
      timeout,
    ]);

    if (outcome === "timeout") {
      return {
        state: "degraded",
        detail: `no response from the provider within ${timeoutMs}ms (request aborted)`,
      };
    }
    if (outcome.ok) {
      return { state: "ok", detail: `provider answered in ${Date.now() - started}ms` };
    }
    return { state: "degraded", detail: "provider probe returned no result" };
  } catch (err) {
    // The class, never the message: an SES error carries the address it
    // rejected, and this string is served from a public endpoint.
    const name = safeErrorName(err) ?? "Error";
    return { state: "degraded", detail: `provider call failed (${name})` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface CacheEntry {
  at: number;
  result: ReachabilityResult;
}

let cache: CacheEntry | null = null;

/**
 * Cached reachability for the process. `now` is injectable so the cache can be
 * tested without sleeping.
 */
export async function providerReachability(options: {
  probe: (signal: AbortSignal) => Promise<unknown>;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}): Promise<{ result: ReachabilityResult; cached: boolean }> {
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const at = now();

  if (cache && at - cache.at < ttl) {
    return { result: cache.result, cached: true };
  }

  const result = await probeWithTimeout(options.probe, options.timeoutMs);
  // A skipped/unconfigured process has nothing to retry; cache everything else
  // so a single slow probe cannot turn into one probe per health poll.
  cache = { at, result };
  return { result, cached: false };
}

/** Test-only: forget the cached probe. */
export function resetProviderReachabilityCache(): void {
  cache = null;
}
