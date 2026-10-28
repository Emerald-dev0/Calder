import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, emails, type DbClient } from "@calder/db";

/**
 * Are the sends that finished recently succeeding?
 *
 * The signal this exists for: a stream showing "5 sent / 0 delivered / 0
 * bounced" is ambiguous, but "9 of the last 10 messages failed" is not. Today's
 * outage produced exactly that shape in the database — 9 failed, 47 stuck, 1
 * delivered — and every health surface said the provider was fine because none
 * of them looked at the messages.
 *
 * Deliberately narrow: it counts rows that reached a *terminal* state inside a
 * short window, so it measures "is delivery working right now" rather than
 * "has anything ever failed". A single bounce in a clean window does not page
 * anyone; a majority-failure window does.
 */

/** Statuses where the provider accepted the message (good outcome). */
const ACCEPTED_STATUSES = ["sent", "delivered", "bounced", "complained"] as const;
/** Terminal failure. `suppressed` is excluded: it was never attempted. */
const FAILED_STATUS = "failed";

export const OUTCOME_WINDOW_MINUTES = 60;
/** Below this many finished messages, a ratio is noise, not a signal. */
export const OUTCOME_MIN_SAMPLE = 5;
/** At or above this failure share, delivery is broken rather than unlucky. */
export const OUTCOME_FAIL_RATIO = 0.5;

export interface DeliveryOutcomeFacts {
  windowMinutes: number;
  /** Messages the provider accepted inside the window. */
  accepted: number;
  /** Messages that ended in a terminal failure inside the window. */
  failed: number;
}

export interface DeliveryOutcomeVerdict {
  state: "ok" | "degraded" | "idle";
  detail: string;
}

/**
 * Pure: facts in, sentence out. Kept separate from the query so the wording and
 * the thresholds are testable without a database, and so `/ready` and any
 * future alert rule cannot disagree about what "broken" means.
 */
export function classifyDeliveryOutcomes(facts: DeliveryOutcomeFacts): DeliveryOutcomeVerdict {
  const { windowMinutes, accepted, failed } = facts;
  const finished = accepted + failed;

  if (finished < OUTCOME_MIN_SAMPLE) {
    return {
      state: "idle",
      detail:
        finished === 0
          ? `no messages finished in the last ${windowMinutes} minutes`
          : `only ${finished} message${finished === 1 ? "" : "s"} finished in the last ${windowMinutes} minutes: too few to judge`,
    };
  }

  const ratio = failed / finished;
  const percent = Math.round(ratio * 100);

  if (ratio >= OUTCOME_FAIL_RATIO) {
    return {
      state: "degraded",
      detail:
        `${failed} of ${finished} messages that finished in the last ${windowMinutes} minutes ` +
        `failed (${percent}%). Accepted mail is not being delivered: check the provider ` +
        `(credentials, region, identity verification) and the drain.`,
    };
  }

  return {
    state: "ok",
    detail:
      `${accepted} of ${finished} messages finished in the last ${windowMinutes} minutes ` +
      `were accepted by the provider (${100 - percent}%)`,
  };
}

/**
 * Measure the window. `created_at` is indexed, so this is a range scan over the
 * last hour rather than a walk of the whole table.
 */
export async function deliveryOutcomeFacts(
  db: DbClient,
  opts: { windowMinutes?: number; now?: Date } = {}
): Promise<DeliveryOutcomeFacts> {
  const windowMinutes = opts.windowMinutes ?? OUTCOME_WINDOW_MINUTES;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - windowMinutes * 60_000);

  const rows = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(
      and(
        gte(emails.createdAt, since),
        // Test rows are simulated delivery; counting them would make a
        // production incident look half as bad.
        eq(emails.env, "live"),
        inArray(emails.status, [...ACCEPTED_STATUSES, FAILED_STATUS])
      )
    )
    .groupBy(emails.status);

  let accepted = 0;
  let failed = 0;
  for (const row of rows) {
    const n = Number(row.value);
    if (row.status === FAILED_STATUS) failed += n;
    else accepted += n;
  }
  return { windowMinutes, accepted, failed };
}

/**
 * How `/ready` must render a verdict.
 *
 * "idle" means the window contained too few finished messages to judge. It is
 * not health — it is the absence of evidence — so it is reported as `skipped`.
 * Rendering it as `ok` was the same defect as `driver=ses`: a surface claiming
 * something it never measured. During the outage this check would have said
 * `ok` on every request, because one failure and one delivery is "too few".
 */
export function readinessCheck(verdict: DeliveryOutcomeVerdict): {
  state: "ok" | "degraded" | "skipped";
  detail: string;
} {
  if (verdict.state === "degraded") return { state: "degraded", detail: verdict.detail };
  if (verdict.state === "idle") return { state: "skipped", detail: verdict.detail };
  return { state: "ok", detail: verdict.detail };
}

export interface DeliveryFailureFact {
  /** The reason recorded on the row — an allowlisted code or fixed sentence. */
  code: string;
  minutesAgo: number;
}

/**
 * The newest failure inside the window, whatever the ratio says.
 *
 * The threshold above answers "is delivery broken for most messages?". This
 * answers "what broke, and when?" — the question a single failed send raises
 * and a ratio of 1-in-3 cannot. Only the reason is returned: it has already
 * been through the allowlist that writes `last_error`, so it cannot contain
 * recipient or provider detail.
 */
export async function lastDeliveryFailure(
  db: DbClient = getDb(),
  opts: { windowMinutes?: number; now?: Date } = {}
): Promise<DeliveryFailureFact | null> {
  const windowMinutes = opts.windowMinutes ?? OUTCOME_WINDOW_MINUTES;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - windowMinutes * 60_000);

  const [row] = await db
    .select({ lastError: emails.lastError, updatedAt: emails.updatedAt })
    .from(emails)
    .where(
      and(gte(emails.createdAt, since), eq(emails.env, "live"), eq(emails.status, FAILED_STATUS))
    )
    .orderBy(desc(emails.updatedAt))
    .limit(1);

  if (!row) return null;
  const ageMs = now.getTime() - new Date(row.updatedAt).getTime();
  return {
    code: row.lastError ?? "failed with no recorded reason",
    minutesAgo: Math.max(0, Math.round(ageMs / 60_000)),
  };
}

/**
 * Codes that mean the platform cannot send, as opposed to one message that
 * could not be delivered. At a million senders something is always failing
 * inside the hour; a check that turns red for every bad address is a check
 * nobody reads. These are the ones that mean every send is at risk.
 */
const SYSTEMIC_FAILURE_CODES = new Set([
  "provider_error",
  "email_provider_not_configured",
  "SesError",
  "AccessDenied",
  "AccessDeniedException",
  "NotAuthorized",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "ExpiredTokenException",
  "CredentialsProviderError",
  "ConfigurationSetDoesNotExistException",
  "ConfigurationSetSendingPausedException",
  "AccountSendingPausedException",
  "AccountSuspendedException",
  "SendingPausedException",
  "MailFromDomainNotVerified",
  "MailFromDomainNotVerifiedException",
  "LimitExceededException",
  "InternalServiceErrorException",
  "Throttling",
  "TooManyRequestsException",
  "organization_sending_unavailable",
  "sender_not_ready",
  "gmail_cap",
  "gmail_credentials_missing",
  "gmail_revoked",
  "gmail_suspended",
  "gmail_velocity_limit",
  "invalid_grant",
  "unauthorized_client",
  "insufficientPermissions",
  "dailyLimitExceeded",
  "rateLimitExceeded",
]);

/**
 * Is the newest failure a platform fault or a single message?
 *
 * `Exhausted: provider_error` and `Exhausted after 5 attempts: Throttling` both
 * carry the same reason under a different prefix, so the prefix is stripped
 * before the lookup.
 */
export function classifyLastFailure(code: string): "ok" | "degraded" {
  const bare = code.replace(/^Exhausted(?: after \d+ attempts)?:\s*/, "").trim();
  if (bare.startsWith("Sending is currently unavailable")) return "degraded";
  return SYSTEMIC_FAILURE_CODES.has(bare) ? "degraded" : "ok";
}

/** Pure: the sentence `/ready` prints for a failure fact. */
export function describeDeliveryFailure(fact: DeliveryFailureFact): string {
  const when = fact.minutesAgo === 0 ? "less than a minute ago" : `${fact.minutesAgo} min ago`;
  return `last failure: ${fact.code} (${when})`;
}

/** Convenience for the readiness route: measure, then judge. */
export async function deliveryOutcomes(
  db: DbClient = getDb(),
  opts: { windowMinutes?: number; now?: Date } = {}
): Promise<DeliveryOutcomeVerdict> {
  return classifyDeliveryOutcomes(await deliveryOutcomeFacts(db, opts));
}
