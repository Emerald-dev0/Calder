import { and, eq, lt, ne } from "drizzle-orm";
import { domains } from "./schema/domains.js";
import type { getDb } from "./client.js";
import {
  CHALLENGE_TTL_MS,
  VERIFY_RATE_LIMIT,
  VERIFY_WINDOW_MS,
  checkOwnership,
  defaultTxtOracle,
  expectedTxtHost,
  expectedTxtValue,
  newVerificationToken,
  type TxtOracle,
} from "./dns-challenge.js";

/**
 * Domain verification state machine (M4.1, ADR-039):
 *
 *   pending ──verify──▶ verified           (TXT matched; atomic flip)
 *   pending ──verify──▶ failed             (TXT missing/mismatch; retryable)
 *   failed  ──verify──▶ verified | failed  (retries allowed within window)
 *   pending|failed ──ttl──▶ expired        (clock check on read/attempt)
 *   expired ──regenerate──▶ pending        (new token, new TTL)
 *   verified ───────────────  (terminal; a new challenge would need delete+recreate)
 *
 * Cross-tenant: if ANOTHER project already holds `verified` for this domain,
 * registration and verification are both denied — first proof wins (409).
 */

export type VerifyOutcome =
  | { kind: "verified"; domain: string; verifiedAt: Date }
  | {
      kind: "mismatch";
      status: "failed";
      expected: { host: string; value: string };
      found: string[];
      attemptsLeft: number;
    }
  | { kind: "dns_error"; status: "failed"; message: string; attemptsLeft: number }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "expired"; retryAfterSec: null }
  | { kind: "cross_tenant"; domain: string }
  | { kind: "not_found" };

interface AttemptRow {
  id: string;
  projectId: string;
  domain: string;
  status: "pending" | "verified" | "failed" | "expired";
  verificationToken: string | null;
  verificationExpiresAt: Date | null;
  verifyAttempts: number;
  verifyWindowStart: Date | null;
  verifiedAt: Date | null;
}

type Db = ReturnType<typeof getDb>;

/** Sweep pending/failed rows past TTL into `expired` (clock check, no cron needed). */
export async function sweepExpiredChallenges(db: Db, projectId?: string): Promise<number> {
  const conds = [
    lt(domains.verificationExpiresAt, new Date()),
    ne(domains.status, "verified"),
    ne(domains.status, "expired"),
  ];
  if (projectId) conds.push(eq(domains.projectId, projectId));
  const rows = await db.update(domains).set({ status: "expired" }).where(and(...conds)).returning({
    id: domains.id,
  });
  return rows.length;
}

/** Start (or restart, after expiry) a challenge row. */
export async function createChallenge(
  db: Db,
  input: { projectId: string; domain: string; id: string }
): Promise<
  | { kind: "created"; id: string; token: string; expiresAt: Date }
  | { kind: "existing"; id: string; token: string | null; status: string; expiresAt: Date | null }
  | { kind: "cross_tenant" }
> {
  const domain = input.domain.trim().toLowerCase();
  // Another tenant already proved this domain — first proof wins.
  const [foreignVerified] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.domain, domain), ne(domains.projectId, input.projectId), eq(domains.status, "verified")))
    .limit(1);
  if (foreignVerified) return { kind: "cross_tenant" };

  const [existing] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.projectId, input.projectId), eq(domains.domain, domain)))
    .limit(1);
  if (existing) {
    // Idempotent create: same project + domain returns the live challenge
    // (regeneration is a separate, deliberate POST /:id/token).
    return {
      kind: "existing",
      id: existing.id,
      token: existing.status === "expired" ? null : existing.verificationToken,
      status: existing.status,
      expiresAt: existing.verificationExpiresAt,
    };
  }
  const token = newVerificationToken();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.insert(domains).values({
    id: input.id,
    projectId: input.projectId,
    domain,
    status: "pending",
    verificationMethod: "dns",
    verificationToken: token,
    verificationExpiresAt: expiresAt,
  });
  return { kind: "created", id: input.id, token, expiresAt };
}

/** Mint a fresh challenge for an expired row (or roll a compromised token). */
export async function regenerateChallenge(
  db: Db,
  projectId: string,
  domainId: string
): Promise<{ kind: "ok"; token: string; expiresAt: Date } | { kind: "not_found" } | { kind: "verified" }> {
  const token = newVerificationToken();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const [row] = await db
    .select({ status: domains.status })
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.projectId, projectId)))
    .limit(1);
  if (!row) return { kind: "not_found" };
  if (row.status === "verified") return { kind: "verified" };
  await db
    .update(domains)
    .set({
      verificationToken: token,
      verificationExpiresAt: expiresAt,
      status: "pending",
      verifyAttempts: 0,
      verifyWindowStart: null,
      lastVerifyError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(domains.id, domainId), eq(domains.projectId, projectId)));
  return { kind: "ok", token, expiresAt };
}

/**
 * Attempt verification. Rate-limited per rolling hour; the verified flip is
 * conditional (`WHERE status != 'verified'`) so concurrent attempts cannot
 * double-write the audit-worthy transition.
 */
export async function attemptVerification(
  db: Db,
  projectId: string,
  domainId: string,
  oracle: TxtOracle = defaultTxtOracle()
): Promise<VerifyOutcome> {
  const [row] = (await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.projectId, projectId)))
    .limit(1)) as AttemptRow[];
  if (!row) return { kind: "not_found" };
  if (row.status === "verified")
    return { kind: "verified", domain: row.domain, verifiedAt: row.verifiedAt ?? new Date() };

  const now = new Date();
  // Expired challenges must be re-issued, not verified against a dead token.
  if (row.verificationExpiresAt && row.verificationExpiresAt < now) {
    await db
      .update(domains)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(domains.id, row.id), ne(domains.status, "verified")));
    return { kind: "expired", retryAfterSec: null };
  }
  if (!row.verificationToken) return { kind: "expired", retryAfterSec: null };

  // Rolling one-hour attempt window.
  const windowStart = row.verifyWindowStart && now < new Date(row.verifyWindowStart.getTime() + VERIFY_WINDOW_MS)
    ? row.verifyWindowStart
    : now;
  const attempts = windowStart === now ? 0 : row.verifyAttempts;
  if (attempts >= VERIFY_RATE_LIMIT) {
    return {
      kind: "rate_limited",
      retryAfterSec: Math.ceil((windowStart.getTime() + VERIFY_WINDOW_MS - now.getTime()) / 1000),
    };
  }

  const expected = expectedTxtValue(row.verificationToken);
  const host = expectedTxtHost(row.domain);
  const verdict = await checkOwnership(oracle, host, expected);
  const attemptsAfter = attempts + 1;
  const attemptsLeft = Math.max(0, VERIFY_RATE_LIMIT - attemptsAfter);

  if (verdict.kind === "verified") {
    const verifiedAt = now;
    const flipped = await db
      .update(domains)
      .set({
        status: "verified",
        verifiedAt,
        lastVerifyError: null,
        verifyAttempts: attemptsAfter,
        verifyWindowStart: windowStart,
        updatedAt: now,
      })
      .where(and(eq(domains.id, row.id), eq(domains.projectId, projectId), ne(domains.status, "verified")))
      .returning({ id: domains.id });
    if (flipped.length === 0) {
      // Concurrent attempt landed first — treat as verified.
      return { kind: "verified", domain: row.domain, verifiedAt };
    }
    // Audit once per transition; the conditional update above ensures
    // concurrency cannot write this twice.
    const { auditLogs } = await import("./schema/system.js");
    await db
      .insert(auditLogs)
      .values({
        id: `alog_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        projectId,
        action: "domain.verified",
        targetType: "domain",
        targetId: row.id,
        metadata: { domain: row.domain, method: "dns_txt", host, attempts: attemptsAfter },
      })
      .catch(() => {});
    return { kind: "verified", domain: row.domain, verifiedAt };
  }

  const errorNote =
    verdict.kind === "dns_error" ? verdict.message : `TXT mismatch at ${host}`;
  await db
    .update(domains)
    .set({
      status: "failed",
      lastVerifyError: errorNote,
      verifyAttempts: attemptsAfter,
      verifyWindowStart: windowStart,
      updatedAt: now,
    })
    .where(and(eq(domains.id, row.id), eq(domains.projectId, projectId)));

  if (verdict.kind === "dns_error")
    return { kind: "dns_error", status: "failed", message: verdict.message, attemptsLeft };
  return {
    kind: "mismatch",
    status: "failed",
    expected: { host, value: expected },
    found: verdict.found,
    attemptsLeft,
  };
}

/** Public, secret-free projection for list/detail responses. */
export function publicDomainProjection(row: {
  id: string;
  domain: string;
  status: string;
  verificationToken: string | null;
  verificationExpiresAt: Date | null;
  verifiedAt: Date | null;
  lastVerifyError: string | null;
  verifyAttempts: number;
  sesIdentityStatus: string | null;
  dkimStatus: string | null;
  dkimRecords: unknown;
  createdAt: Date;
}) {
  const challengeVisible = row.status !== "verified" && row.status !== "expired";
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    verification: challengeVisible && row.verificationToken
      ? {
          method: "dns_txt" as const,
          host: expectedTxtHost(row.domain),
          value: expectedTxtValue(row.verificationToken),
          expiresAt: row.verificationExpiresAt?.toISOString() ?? null,
        }
      : null,
    lastVerifyError: row.lastVerifyError,
    verifyAttempts: row.verifyAttempts,
    ses: {
      identityStatus: row.sesIdentityStatus ?? "not_linked",
      dkimStatus: row.dkimStatus,
      dkimRecords: row.dkimRecords ?? [],
    },
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
