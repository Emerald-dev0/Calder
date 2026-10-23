import { cookies } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import {
  apiKeys,
  audiences,
  auditLogs,
  contacts,
  domains,
  emails,
  getDb,
  organizationMembers,
  organizations,
  projects,
  senderIdentities,
  users,
} from "@calder/db";
import { getSessionUser, SESSION_COOKIE } from "@calder/auth";
import { logger } from "@calder/observability";
import { sendCompanyEmailQuietly } from "@calder/notify";
import { verifyExportToken } from "../../../../lib/data-export";

/**
 * GET /api/account/export?token=…
 *
 * The archive is generated on demand from the live database rather than stored
 * somewhere, so "ready" means "the link works", not "a file is sitting in a
 * bucket". That also keeps deletions honest: a row removed a minute ago cannot
 * come back through an export made yesterday.
 *
 * Two gates, deliberately: a signed link *and* a session for the same user.
 * A forwarded email is not enough.
 */

export const dynamic = "force-dynamic";

const ROW_CAP = 5000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const claim = verifyExportToken(token);
  if (!claim) {
    return json({ error: "This link is invalid or has expired. Request a new export." }, 401);
  }

  const cookieStore = await cookies();
  const session = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session || session.userId !== claim.userId) {
    return json({ error: "Sign in as the account that requested this export." }, 401);
  }

  const db = getDb();
  const userId = session.userId;

  try {
    const [account] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const memberships = await db
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        joinedAt: organizationMembers.createdAt,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));

    const orgIds = memberships.map((m) => m.organizationId);
    const orgs =
      orgIds.length > 0
        ? await db
            .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
            .from(organizations)
            .where(inArray(organizations.id, orgIds))
        : [];

    const projectRows =
      orgIds.length > 0
        ? await db
            .select({
              id: projects.id,
              organizationId: projects.organizationId,
              name: projects.name,
              slug: projects.slug,
              createdAt: projects.createdAt,
            })
            .from(projects)
            .where(inArray(projects.organizationId, orgIds))
        : [];
    const projectIds = projectRows.map((p) => p.id);

    const [keys, senders, domainRows, audienceRows] = await Promise.all([
      projectIds.length > 0
        ? db
            .select({
              id: apiKeys.id,
              projectId: apiKeys.projectId,
              name: apiKeys.name,
              prefix: apiKeys.keyPrefix,
              env: apiKeys.env,
              createdAt: apiKeys.createdAt,
              lastUsedAt: apiKeys.lastUsedAt,
              revokedAt: apiKeys.revokedAt,
            })
            .from(apiKeys)
            .where(inArray(apiKeys.projectId, projectIds))
            .limit(ROW_CAP)
        : [],
      projectIds.length > 0
        ? db
            .select({
              id: senderIdentities.id,
              projectId: senderIdentities.projectId,
              email: senderIdentities.email,
              displayName: senderIdentities.displayName,
              status: senderIdentities.status,
            })
            .from(senderIdentities)
            .where(inArray(senderIdentities.projectId, projectIds))
            .limit(ROW_CAP)
        : [],
      projectIds.length > 0
        ? db
            .select({
              id: domains.id,
              projectId: domains.projectId,
              domain: domains.domain,
              status: domains.status,
              verifiedAt: domains.verifiedAt,
            })
            .from(domains)
            .where(inArray(domains.projectId, projectIds))
            .limit(ROW_CAP)
        : [],
      projectIds.length > 0
        ? db
            .select({ id: audiences.id, projectId: audiences.projectId, name: audiences.name })
            .from(audiences)
            .where(inArray(audiences.projectId, projectIds))
            .limit(ROW_CAP)
        : [],
    ]);

    const contactRows =
      projectIds.length > 0
        ? await db
            .select({
              id: contacts.id,
              projectId: contacts.projectId,
              email: contacts.email,
              firstName: contacts.firstName,
              lastName: contacts.lastName,
              status: contacts.status,
              consentSource: contacts.consentSource,
              createdAt: contacts.createdAt,
            })
            .from(contacts)
            .where(inArray(contacts.projectId, projectIds))
            .limit(ROW_CAP)
        : [];

    const messageRows =
      projectIds.length > 0
        ? await db
            .select({
              id: emails.id,
              projectId: emails.projectId,
              to: emails.to,
              from: emails.from,
              subject: emails.subject,
              status: emails.status,
              createdAt: emails.createdAt,
            })
            .from(emails)
            .where(inArray(emails.projectId, projectIds))
            .limit(ROW_CAP)
        : [];

    const auditRows =
      orgIds.length > 0
        ? await db
            .select({
              id: auditLogs.id,
              organizationId: auditLogs.organizationId,
              action: auditLogs.action,
              createdAt: auditLogs.createdAt,
            })
            .from(auditLogs)
            .where(inArray(auditLogs.organizationId, orgIds))
            .limit(ROW_CAP)
        : [];

    const archive = {
      generatedAt: new Date().toISOString(),
      note: "Message bodies and stored credentials are not included. API keys are listed by prefix only.",
      account,
      memberships,
      organizations: orgs,
      projects: projectRows,
      apiKeys: keys,
      senders,
      domains: domainRows,
      audiences: audienceRows,
      contacts: contactRows,
      messages: messageRows,
      auditLog: auditRows,
      rowCap: ROW_CAP,
    };

    return new Response(JSON.stringify(archive, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="calder-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    logger.error({ err, userId }, "Data export failed");
    await sendCompanyEmailQuietly(db, {
      id: "account.data_export_failed",
      to: session.email,
      userId,
      idempotencyKey: `export-failed:${userId}:${Date.now()}`,
      data: { requestedAt: new Date().toISOString().slice(0, 10) },
    });
    return json({ error: "The export could not be produced. We have emailed you." }, 500);
  }
}
