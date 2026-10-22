import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { getConfig } from "@calder/config";
import {
  apiKeys,
  organizations,
  orgInvitations,
  projects,
  users,
  type DbClient,
} from "@calder/db";
import { logger } from "@calder/observability";
import { sendCompanyEmail, sendOrganizationEmail } from "@calder/notify";

/**
 * Time-driven company mail.
 *
 * Some emails are not caused by a request: an invitation that is about to
 * expire, a key that stops working next week. They belong in a sweep rather
 * than in a route, and they run through the same catalogue and the same
 * idempotency keys as everything else, so a cron that fires twice does not
 * mail anybody twice.
 *
 * Scope is intentionally small. Each entry below has a real, dated fact behind
 * it; nothing is sent to say "we noticed you have not used the product".
 */

export interface CompanyEmailSweepResult {
  invitationsReminded: number;
  keysWarned: number;
  failed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function appUrl(): string {
  return getConfig().APP_URL.replace(/\/$/, "");
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Remind invitees whose invitation lapses within two days.
 *
 * The original invite is stored as a hash only, so a reminder cannot repeat
 * yesterday's link. Rotating the token is the honest fix: the link in the new
 * email works, every older link stops working, and the expiry date does not
 * move. The idempotency key is the expiry instant, so one invitation produces
 * at most one reminder however often the sweep runs.
 */
async function remindExpiringInvitations(
  db: DbClient,
  now: Date
): Promise<{ reminded: number; failed: number }> {
  const soon = new Date(now.getTime() + 2 * DAY_MS);
  const settled = new Date(now.getTime() - DAY_MS);

  const rows = await db
    .select({
      id: orgInvitations.id,
      email: orgInvitations.email,
      role: orgInvitations.role,
      expiresAt: orgInvitations.expiresAt,
      organizationId: orgInvitations.organizationId,
      organizationName: organizations.name,
      invitedBy: orgInvitations.invitedBy,
    })
    .from(orgInvitations)
    .innerJoin(organizations, eq(organizations.id, orgInvitations.organizationId))
    .where(
      and(
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, now),
        lte(orgInvitations.expiresAt, soon),
        lt(orgInvitations.createdAt, settled)
      )
    )
    .limit(200);

  let reminded = 0;
  let failed = 0;

  for (const invite of rows) {
    try {
      // Name the inviter, but never at the cost of the reminder: a deleted
      // inviter leaves a generic "a teammate", which is still true.
      let inviterName: string | null = null;
      if (invite.invitedBy) {
        const [inviter] = await db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, invite.invitedBy))
          .limit(1);
        inviterName = inviter?.name ?? inviter?.email ?? null;
      }

      const rawToken = randomBytes(32).toString("hex");
      await db
        .update(orgInvitations)
        .set({ tokenHash: createHash("sha256").update(rawToken).digest("hex") })
        .where(eq(orgInvitations.id, invite.id));

      const expiresInDays = Math.max(
        1,
        Math.ceil((invite.expiresAt.getTime() - now.getTime()) / DAY_MS)
      );

      const result = await sendCompanyEmail(db, {
        id: "organization.invitation_reminder",
        to: invite.email,
        organizationId: invite.organizationId,
        idempotencyKey: `invite-reminder:${invite.id}:${invite.expiresAt.toISOString()}`,
        data: {
          inviterName: inviterName ?? undefined,
          organizationName: invite.organizationName,
          role: invite.role,
          expiresInDays,
          acceptUrl: `${appUrl()}/invite/${rawToken}`,
        },
      });

      if (result.status === "sent") reminded += 1;
    } catch (err) {
      failed += 1;
      logger.warn(
        { inviteId: invite.id, err: err instanceof Error ? err.message : "unknown" },
        "Invitation reminder failed"
      );
    }
  }

  return { reminded, failed };
}

/**
 * Warn the workspace a week before one of its API keys stops working.
 *
 * Keys are workspace state, so the mail goes to owners and admins through
 * `sendOrganizationEmail`. One key produces one warning per expiry date: the
 * sweep may run hourly, the mailbox gets one message.
 */
async function warnExpiringApiKeys(
  db: DbClient,
  now: Date
): Promise<{ warned: number; failed: number }> {
  const soon = new Date(now.getTime() + 7 * DAY_MS);

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      env: apiKeys.env,
      expiresAt: apiKeys.expiresAt,
      organizationId: projects.organizationId,
    })
    .from(apiKeys)
    .innerJoin(projects, eq(projects.id, apiKeys.projectId))
    .where(
      and(
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, now),
        lte(apiKeys.expiresAt, soon)
      )
    )
    .limit(200);

  let warned = 0;
  let failed = 0;

  for (const key of rows) {
    if (!key.expiresAt) continue;
    try {
      const result = await sendOrganizationEmail(db, {
        id: "operations.api_key_expiring",
        organizationId: key.organizationId,
        idempotencyKey: `apikey-expiring:${key.id}:${isoDate(key.expiresAt)}`,
        data: {
          keyName: key.name,
          keyPrefix: key.keyPrefix,
          env: key.env,
          expiresOn: isoDate(key.expiresAt),
        },
      });
      warned += result.sent;
    } catch (err) {
      failed += 1;
      logger.warn(
        { keyId: key.id, err: err instanceof Error ? err.message : "unknown" },
        "API key expiry warning failed"
      );
    }
  }

  return { warned, failed };
}

/** Run every scheduled company-email rule once. Safe to call repeatedly. */
export async function runCompanyEmailSweep(
  db: DbClient,
  now: Date = new Date()
): Promise<CompanyEmailSweepResult> {
  const invitations = await remindExpiringInvitations(db, now);
  const keys = await warnExpiringApiKeys(db, now);

  const result: CompanyEmailSweepResult = {
    invitationsReminded: invitations.reminded,
    keysWarned: keys.warned,
    failed: invitations.failed + keys.failed,
  };

  if (result.invitationsReminded > 0 || result.keysWarned > 0 || result.failed > 0) {
    logger.info(result, "Company email sweep completed");
  }
  return result;
}
