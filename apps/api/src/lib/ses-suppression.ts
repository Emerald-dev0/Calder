/**
 * The sending provider's own suppression list, consulted before delivery.
 *
 * Why this exists: our `suppressions` table only knows what *we* observed. SES
 * maintains a separate, account-level list from every bounce and complaint it
 * sees — including ones whose notification never reached us, ones added in the
 * AWS console, and ones recorded against another identity or environment using
 * the same AWS account. Mail to an address on that list is refused by SES no
 * matter what our database says, so "we checked our table" is not an answer to
 * "can this address receive mail".
 *
 * The rules:
 *
 *   - **SES is the authority.** A live delivery asks SES about the recipient
 *     before it is handed to the provider.
 *   - **Fail closed.** If the answer cannot be obtained, the message is not
 *     handed over. It is requeued with a delay, not failed: an API blip must
 *     not destroy a customer's mail, and it must not turn into a delivery
 *     attempt against a list we could not read.
 *   - **Cache for seconds, not minutes.** A suppression is a hard fact about a
 *     mailbox, but the list changes when a recipient complains. A short cache
 *     keeps a batch of mail to one address from making one API call per
 *     message without letting a fresh complaint slip through for long.
 *   - **Mirror what we learn.** A suppression found here is written to
 *     `ses_suppressions`, so the ingest path (which must stay cheap) refuses
 *     that address immediately afterwards.
 */

import { eq } from "drizzle-orm";
import { getDb, sesSuppressions, type DbClient } from "@calder/db";
import { getSuppressedDestination, type SesSuppressionReason } from "@calder/providers";
import { logger } from "@calder/observability";

export type SesSuppressionVerdict =
  /** SES says this address can be mailed. */
  | { state: "clear" }
  /** SES says it cannot, and why. */
  | {
      state: "suppressed";
      reason: SesSuppressionReason;
      lastUpdateTime: Date | null;
    }
  /**
   * SES was asked and did not answer. The caller must not deliver.
   */
  | { state: "unknown"; error: string }
  /**
   * No SES credentials are configured (local scaffold, mock provider). There is
   * no account list to consult, so there is nothing to fail closed *to*.
   */
  | { state: "unconfigured" };

export interface SuppressionCheckOptions {
  /** Injectable for tests; production uses the SDK client. */
  lookup?: (email: string) => Promise<{
    suppressed: boolean;
    reason?: SesSuppressionReason;
    lastUpdateTime?: Date | null;
  }>;
  now?: () => number;
  /** Set false in tests that need every call to hit the lookup. */
  cache?: boolean;
}

/** How long a "clear" answer is reused. Short: the list can change at any time. */
const CLEAR_TTL_MS = 60_000;
/** A suppression is a hard fact, but it is not eternal: an address can be fixed. */
const SUPPRESSED_TTL_MS = 5 * 60_000;
/** Bounded so a long-running process cannot grow this without limit. */
const CACHE_MAX = 5_000;

interface CacheEntry {
  verdict: SesSuppressionVerdict;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Test seam, mirroring `setRawMessageStoreForTests` in @calder/providers: the
 * delivery path needs a way to answer "SES says suppressed" and "SES is down"
 * without a network. Production never sets this.
 */
let testLookup: SuppressionCheckOptions["lookup"] | null = null;

export function setSuppressionLookupForTests(fn: SuppressionCheckOptions["lookup"] | null): void {
  testLookup = fn;
  cache.clear();
}

/** Test hook: forget every cached answer. */
export function clearSuppressionCache(): void {
  cache.clear();
}

export function suppressionCacheSize(): number {
  return cache.size;
}

/**
 * Is there an account list to ask about?
 *
 * Deliberately the same signal `resolveEmailProvider` uses to decide whether it
 * can deliver real mail: without credentials there is no SES, and a check
 * against nothing must not be reported as a pass.
 */
export function sesSuppressionCheckConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

function remember(email: string, verdict: SesSuppressionVerdict, now: number): void {
  if (verdict.state === "unknown" || verdict.state === "unconfigured") return;
  if (cache.size >= CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest. Dropping
    // one entry is enough to stay bounded and keeps this O(1).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(email, {
    verdict,
    expiresAt: now + (verdict.state === "suppressed" ? SUPPRESSED_TTL_MS : CLEAR_TTL_MS),
  });
}

/**
 * Ask SES about one recipient.
 *
 * Returns a verdict; never throws. `unknown` is a first-class answer because the
 * caller's next step (do not send, retry later) is different from both other
 * outcomes.
 */
export async function checkSesSuppression(
  email: string,
  options: SuppressionCheckOptions = {}
): Promise<SesSuppressionVerdict> {
  const address = email.trim().toLowerCase();
  if (!address) return { state: "clear" };
  if (!sesSuppressionCheckConfigured()) return { state: "unconfigured" };

  const now = options.now?.() ?? Date.now();
  if (options.cache !== false) {
    const cached = cache.get(address);
    if (cached && cached.expiresAt > now) return cached.verdict;
  }

  const lookup = options.lookup ?? testLookup ?? ((to: string) => getSuppressedDestination(to));
  try {
    const answer = await lookup(address);
    const verdict: SesSuppressionVerdict = answer.suppressed
      ? {
          state: "suppressed",
          reason: answer.reason ?? "BOUNCE",
          lastUpdateTime: answer.lastUpdateTime ?? null,
        }
      : { state: "clear" };
    remember(address, verdict, now);
    return verdict;
  } catch (err) {
    const error = err instanceof Error ? err.message : "unknown error";
    // Not cached: the next attempt should ask again rather than inherit a
    // transient failure for the whole TTL.
    logger.warn({ err: error }, "SES suppression lookup failed");
    return { state: "unknown", error };
  }
}

/**
 * Record an account-level suppression locally.
 *
 * Idempotent: the reconcile job and a delivery-time refusal can both report the
 * same address, and the row should simply become fresher, not duplicate. The
 * reason is refreshed only when the caller actually knows it, so a reconcile
 * entry keeps its original story when a delivery only confirms the address is
 * still blocked.
 */
export async function recordAccountSuppression(
  db: DbClient,
  input: {
    email: string;
    reason: SesSuppressionReason;
    lastUpdateTime?: Date | null;
    source: "reconcile" | "delivery";
    now?: Date;
  }
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email) return;
  const now = input.now ?? new Date();
  await db
    .insert(sesSuppressions)
    .values({
      email,
      reason: input.reason,
      lastUpdateTime: input.lastUpdateTime ?? null,
      lastSeenAt: now,
      firstSeenAt: now,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: sesSuppressions.email,
      set: {
        reason: input.reason,
        lastUpdateTime: input.lastUpdateTime ?? null,
        lastSeenAt: now,
        source: input.source,
      },
    });
}

/** Convenience for the delivery path: check, and mirror a positive answer. */
export async function checkAndMirrorSuppression(
  email: string,
  options: SuppressionCheckOptions & { db?: DbClient }
): Promise<SesSuppressionVerdict> {
  const verdict = await checkSesSuppression(email, options);
  if (verdict.state !== "suppressed") return verdict;
  try {
    await recordAccountSuppression(options.db ?? getDb(), {
      email,
      reason: verdict.reason,
      lastUpdateTime: verdict.lastUpdateTime,
      source: "delivery",
    });
  } catch (err) {
    // The refusal still stands — the mirror is an optimisation for the ingest
    // path, not the reason we are refusing.
    logger.warn(
      { err: err instanceof Error ? err.message : "unknown" },
      "Could not mirror SES suppression locally"
    );
  }
  return verdict;
}

/** Read the mirrored list for one address (cheap; used by tests and tooling). */
export async function findAccountSuppression(
  db: DbClient,
  email: string
): Promise<{ email: string; reason: string; lastSeenAt: Date } | null> {
  const [row] = await db
    .select({
      email: sesSuppressions.email,
      reason: sesSuppressions.reason,
      lastSeenAt: sesSuppressions.lastSeenAt,
    })
    .from(sesSuppressions)
    .where(eq(sesSuppressions.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}
