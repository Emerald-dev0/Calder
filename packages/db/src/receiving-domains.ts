/**
 * Receiving-domain lifecycle (Stage 3).
 *
 * A receiving domain is a claim that "mail addressed to `<something>@this` is
 * ours to accept". Turning that claim on safely requires two independent
 * facts, and this module refuses to conflate them:
 *
 *  1. **Ownership** — a TXT record under `_calder-inbound.<domain>`.
 *  2. **Delivery path** — the domain's MX points at our inbound host and
 *     nowhere else. If Google Workspace or Microsoft 365 still appears, we
 *     refuse: adding a second MX next to a live provider splits delivery and
 *     loses mail. The customer receives on a dedicated subdomain instead.
 *
 * Turning it on *also* needs a provisioned SES receipt rule, which is AWS-side
 * infrastructure we cannot create from here. That is recorded separately
 * (`provisionedAt`), so "DNS is right" and "AWS will deliver" can never be
 * mistaken for each other.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  checkMx,
  checkOwnership,
  defaultMxOracle,
  defaultTxtOracle,
  expectedInboundTxtValue,
  newVerificationToken,
  VERIFY_RATE_LIMIT,
  VERIFY_WINDOW_MS,
  type MxOracle,
  type MxRecord,
  type TxtOracle,
} from "./dns-challenge.js";
import type { DbClient } from "./client.js";
import { receivingDomains } from "./schema/inbound.js";

export type CreateReceivingDomainOutcome =
  | { kind: "created"; id: string; token: string }
  | { kind: "existing"; id: string; status: string; token: string }
  | { kind: "cross_tenant"; domain: string }
  | { kind: "invalid"; reason: string };

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Normalise and validate. Kept exported so the API and dashboard agree. */
export function normaliseReceivingDomain(
  raw: string
): { ok: true; domain: string } | { ok: false; reason: string } {
  const domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (domain.length === 0) return { ok: false, reason: "Enter a domain." };
  if (domain.length > 255) return { ok: false, reason: "Domain is too long." };
  if (domain.includes("@")) return { ok: false, reason: "Enter a domain, not an email address." };
  if (!DOMAIN_RE.test(domain)) return { ok: false, reason: "That is not a valid domain name." };
  // A receiving domain must have at least two labels; a bare TLD can never be
  // verified by TXT and is almost always a typo.
  if (domain.split(".").length < 2)
    return { ok: false, reason: "Use a full domain, e.g. inbox.acme.com." };
  return { ok: true, domain };
}

export async function createReceivingDomain(
  db: DbClient,
  input: { id: string; projectId: string; domain: string; mxHost: string; now?: Date }
): Promise<CreateReceivingDomainOutcome> {
  const normalised = normaliseReceivingDomain(input.domain);
  if (!normalised.ok) return { kind: "invalid", reason: normalised.reason };
  const domain = normalised.domain;

  const [existing] = await db
    .select({
      id: receivingDomains.id,
      projectId: receivingDomains.projectId,
      status: receivingDomains.status,
      token: receivingDomains.verificationToken,
    })
    .from(receivingDomains)
    .where(eq(receivingDomains.domain, domain))
    .limit(1);

  if (existing) {
    // Already ours: return the same challenge so the UI can show it again
    // instead of telling a customer their own domain is taken.
    if (existing.projectId === input.projectId)
      return { kind: "existing", id: existing.id, status: existing.status, token: existing.token };
    return { kind: "cross_tenant", domain };
  }

  const token = newVerificationToken();
  await db.insert(receivingDomains).values({
    id: input.id,
    projectId: input.projectId,
    domain,
    status: "pending",
    verificationToken: token,
    mxHost: input.mxHost.toLowerCase(),
    createdAt: input.now ?? new Date(),
    updatedAt: input.now ?? new Date(),
  });
  return { kind: "created", id: input.id, token };
}

export type ReceivingVerifyOutcome =
  | {
      kind: "verified";
      observedMx: MxRecord[];
      /** True only when the SES side is also recorded as done. */
      accepting: boolean;
    }
  | { kind: "txt_missing"; expected: { host: string; value: string } }
  | { kind: "mx_foreign"; others: MxRecord[]; message: string }
  | { kind: "mx_missing"; message: string }
  | { kind: "dns_error"; message: string }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "not_found" };

/**
 * Run both checks and persist the result.
 *
 * Unlike sending domains, a failed check is *not* rate-limited into oblivion:
 * MX changes propagate on the customer's schedule, and being told "try again in
 * an hour" while their DNS is already correct is a support ticket. Attempts are
 * still budgeted, just generously.
 */
export async function attemptReceivingVerification(
  db: DbClient,
  input: {
    projectId: string;
    id: string;
    txt?: TxtOracle;
    mx?: MxOracle;
    now?: Date;
  }
): Promise<ReceivingVerifyOutcome> {
  const now = input.now ?? new Date();
  const [row] = await db
    .select()
    .from(receivingDomains)
    .where(and(eq(receivingDomains.id, input.id), eq(receivingDomains.projectId, input.projectId)))
    .limit(1);
  if (!row) return { kind: "not_found" };

  // Rolling-hour budget, same shape as the sending challenge.
  const windowExpired =
    !row.verifyWindowStart || now.getTime() - row.verifyWindowStart.getTime() > VERIFY_WINDOW_MS;
  const attempts = windowExpired ? 0 : row.verifyAttempts;
  if (attempts >= VERIFY_RATE_LIMIT) {
    const retryAfterMs =
      VERIFY_WINDOW_MS - (now.getTime() - (row.verifyWindowStart?.getTime() ?? now.getTime()));
    return { kind: "rate_limited", retryAfterMs };
  }

  const txt = input.txt ?? defaultTxtOracle();
  const mx = input.mx ?? defaultMxOracle();
  const expectedTxt = {
    host: `_calder-inbound.${row.domain}`,
    value: expectedInboundTxtValue(row.verificationToken),
  };

  const ownership = await checkOwnership(txt, expectedTxt.host, expectedTxt.value);
  const mxVerdict = await checkMx(mx, row.domain, row.mxHost);

  const record = {
    verifyAttempts: attempts + 1,
    verifyWindowStart: windowExpired ? now : row.verifyWindowStart,
    lastCheckedAt: now,
    updatedAt: now,
  };

  if (ownership.kind === "dns_error") {
    await db
      .update(receivingDomains)
      .set({ ...record, status: "failed", lastError: ownership.message })
      .where(eq(receivingDomains.id, row.id));
    return { kind: "dns_error", message: ownership.message };
  }
  if (ownership.kind === "mismatch") {
    const message = `No matching TXT record at ${expectedTxt.host}.`;
    await db
      .update(receivingDomains)
      .set({ ...record, status: "failed", lastError: message, observedTxt: ownership.found })
      .where(eq(receivingDomains.id, row.id));
    return { kind: "txt_missing", expected: expectedTxt };
  }

  // Ownership is proven. Now the part that protects the customer's mail.
  if (mxVerdict.kind === "dns_error") {
    await db
      .update(receivingDomains)
      .set({ ...record, status: "failed", lastError: mxVerdict.message })
      .where(eq(receivingDomains.id, row.id));
    return { kind: "dns_error", message: mxVerdict.message };
  }
  if (mxVerdict.kind === "no_mx") {
    const message = `No MX record for ${row.domain}. Add MX ${row.mxHost} with priority ${row.mxPriority}, or point an existing (unused) subdomain at us.`;
    await db
      .update(receivingDomains)
      .set({ ...record, status: "failed", lastError: message, observedMx: [] })
      .where(eq(receivingDomains.id, row.id));
    return { kind: "mx_missing", message };
  }
  if (mxVerdict.kind === "foreign") {
    const others = mxVerdict.others.slice(0, 5);
    const message =
      `Mail for ${row.domain} is currently delivered elsewhere (${others
        .map((r) => r.exchange)
        .join(", ")}). Calder will not take over live MX records — that would split ` +
      `or interrupt your existing mail. Receive on a dedicated subdomain instead, e.g. inbox.${apexOf(
        row.domain
      )}, and leave ${row.domain}'s MX exactly as it is.`;
    await db
      .update(receivingDomains)
      .set({ ...record, status: "failed", lastError: message, observedMx: mxVerdict.records })
      .where(eq(receivingDomains.id, row.id));
    return { kind: "mx_foreign", others, message };
  }

  const verifiedAt = row.verifiedAt ?? now;
  await db
    .update(receivingDomains)
    .set({
      ...record,
      status: "verified",
      verifiedAt,
      lastError: null,
      observedMx: mxVerdict.records,
      observedTxt: [expectedTxt.value],
    })
    .where(eq(receivingDomains.id, row.id));

  return { kind: "verified", observedMx: mxVerdict.records, accepting: Boolean(row.provisionedAt) };
}

/** Best-effort "acme.com" from "inbox.acme.com" — used only in advice text. */
export function apexOf(domain: string): string {
  const parts = domain.split(".");
  if (parts.length < 3) return domain;
  return parts.slice(1).join(".");
}

export async function disableReceivingDomain(
  db: DbClient,
  input: { projectId: string; id: string; now?: Date }
): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(receivingDomains)
    .set({ status: "disabled", disabledAt: now, updatedAt: now })
    .where(
      and(
        eq(receivingDomains.id, input.id),
        eq(receivingDomains.projectId, input.projectId),
        isNull(receivingDomains.disabledAt)
      )
    )
    .returning({ id: receivingDomains.id });
  return updated.length > 0;
}

/**
 * Record that an operator created the SES receipt rule for this domain.
 *
 * This is an assertion by a human who did the AWS work, not a verification of
 * it — the API requires an admin key and stores who said so. Nothing in this
 * codebase claims AWS is configured unless this row exists, and the report
 * says which domains have it.
 */
export async function markReceivingDomainProvisioned(
  db: DbClient,
  input: { id: string; ruleSetName: string; ruleName: string; actor: string; now?: Date }
): Promise<boolean> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(receivingDomains)
    .set({
      sesRuleSetName: input.ruleSetName,
      sesRuleName: input.ruleName,
      provisionedAt: now,
      provisionedBy: input.actor,
      updatedAt: now,
    })
    .where(eq(receivingDomains.id, input.id))
    .returning({ id: receivingDomains.id });
  return updated.length > 0;
}

/** Retry budget for transient ingest failures before a message is parked. */
export const INBOUND_MAX_ATTEMPTS = 5;

export function shouldRetryProcessing(status: string, attempts: number): boolean {
  return status === "failed" && attempts < INBOUND_MAX_ATTEMPTS;
}
