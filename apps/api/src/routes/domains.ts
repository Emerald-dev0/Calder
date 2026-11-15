import { Hono, type Context } from "hono";
import type { Env } from "../app.js";
import { createDomainSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { AppError, validationError } from "../errors/index.js";
import { getDb, domains as domainsTable } from "@calder/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  attemptVerification,
  createChallenge,
  publicDomainProjection,
  regenerateChallenge,
  sweepExpiredChallenges,
} from "../lib/domain-verification.js";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";
import { logger } from "@calder/observability";

const domains = new Hono<Env>();

function projectAuth(c: Context<Env>): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

function requireProjectManagement(c: Context<Env>): AuthContext {
  const a = projectAuth(c);
  requireScope(a, "manage");
  return a;
}

domains.post("/", authMiddleware, async (c) => {
  const auth = requireProjectManagement(c);
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createDomainSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid domain", 400, parsed.error.flatten());

  const db = getDb();
  // Domains are sold by the plan (2 / 3 / 10). This route is the only path that
  // creates one, so the ceiling belongs here — otherwise the catalogue is
  // documentation of a promise nobody keeps.
  const { assertCanCreateResource, organizationForProject, ResourceLimitError } =
    await import("@calder/db");
  const organizationId = await organizationForProject(db, auth.projectId);
  if (!organizationId) throw new AppError("not_found", "Project not found", 404);
  try {
    await assertCanCreateResource(db, organizationId, "domains");
  } catch (err) {
    if (err instanceof ResourceLimitError) {
      throw new AppError(
        err.code,
        err.message,
        402,
        {
          resource: err.resource,
          tier: err.tier,
          limit: err.limit,
          used: err.used,
          upgrade_tier: err.upgradeTier,
        },
        err.upgradeDisplayName
          ? `Upgrade to ${err.upgradeDisplayName} to add more domains.`
          : undefined
      );
    }
    throw err;
  }
  const result = await createChallenge(db, {
    projectId: auth.projectId,
    domain: parsed.data.domain,
    id: `dom_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
  });
  if (result.kind === "cross_tenant")
    throw new AppError(
      "conflict",
      "This domain is already verified by another organization. Prove ownership from that workspace, or open a support ticket to dispute.",
      409
    );
  if (result.kind === "existing") {
    return c.json(
      {
        data: {
          id: result.id,
          status: result.status,
          challenge: result.token
            ? { available: true as const, expiresAt: result.expiresAt?.toISOString() ?? null }
            : null,
          note: "Domain already registered with this workspace. Fetch it from GET /v1/domains for the verification record.",
        },
      },
      200
    );
  }
  return c.json(
    {
      data: {
        id: result.id,
        domain: parsed.data.domain.toLowerCase(),
        status: "pending",
        verification: {
          method: "dns_txt",
          host: `_calder.${parsed.data.domain.toLowerCase()}`,
          value: `calder-verification=${result.token}`,
          expiresAt: result.expiresAt.toISOString(),
        },
      },
    },
    201
  );
});

domains.get("/", authMiddleware, rateLimitMiddleware("read"), async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const db = getDb();
  await sweepExpiredChallenges(db, auth.projectId);
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const cursor = c.req.query("cursor");
  const conditions = [eq(domainsTable.projectId, auth.projectId)];
  const position = decodeApiCursor(cursor);
  if (position) {
    conditions.push(
      or(
        lt(domainsTable.createdAt, position.createdAt),
        and(eq(domainsTable.createdAt, position.createdAt), lt(domainsTable.id, position.id))
      )!
    );
  }
  const rows = await db
    .select()
    .from(domainsTable)
    .where(and(...conditions))
    .orderBy(desc(domainsTable.createdAt), desc(domainsTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null;
  return c.json({
    data: page.map(publicDomainProjection),
    pagination: { limit, next_cursor: nextCursor },
  });
});

domains.post("/:id/verify", authMiddleware, async (c) => {
  const auth = requireProjectManagement(c);
  const id = c.req.param("id");
  const db = getDb();
  const outcome = await attemptVerification(db, auth.projectId, id);

  // Domain state is workspace state: owners and admins hear about it, and the
  // key is bucketed so a user hammering "verify" does not send a mail per click.
  if (outcome.kind === "verified" || outcome.kind === "dns_error" || outcome.kind === "mismatch") {
    const [domainRow] = await db
      .select({ domain: domainsTable.domain })
      .from(domainsTable)
      .where(eq(domainsTable.id, id))
      .limit(1);
    const verified = outcome.kind === "verified";
    const { sendOrganizationEmail } = await import("@calder/notify");
    await sendOrganizationEmail(db, {
      id: verified ? "operations.domain_verified" : "operations.domain_failed",
      organizationId: auth.organizationId,
      idempotencyKey: verified
        ? `domain:verified:${id}:${outcome.verifiedAt.toISOString()}`
        : `domain:failed:${id}:${new Date().toISOString().slice(0, 10)}`,
      data: {
        domain: domainRow?.domain,
        reason:
          outcome.kind === "dns_error"
            ? "the DNS lookup failed"
            : outcome.kind === "mismatch"
              ? "the TXT record does not match the challenge value yet"
              : undefined,
      },
    }).catch(() => {});
  }

  switch (outcome.kind) {
    case "not_found":
      throw new AppError("not_found", "Domain not found", 404);
    case "cross_tenant":
      throw new AppError("conflict", "Domain verified by another organization", 409);
    case "rate_limited":
      throw new AppError(
        "rate_limit_error",
        `Too many verification attempts. Try again in ${outcome.retryAfterSec}s.`,
        429
      );
    case "expired":
      return c.json(
        {
          data: {
            status: "expired",
            note: "Challenge expired after 72h. POST /v1/domains/:id/token to mint a fresh one.",
          },
        },
        410
      );
    case "verified":
      return c.json({
        data: {
          status: "verified",
          domain: outcome.domain,
          verifiedAt: outcome.verifiedAt.toISOString(),
        },
      });
    case "dns_error":
      return c.json(
        {
          data: {
            status: "failed",
            reason: "dns_error",
            message: outcome.message,
            attemptsLeft: outcome.attemptsLeft,
          },
        },
        200
      );
    case "mismatch":
      return c.json(
        {
          data: {
            status: "failed",
            reason: "txt_not_found",
            expected: outcome.expected,
            found: outcome.found,
            attemptsLeft: outcome.attemptsLeft,
            hint:
              outcome.found.length === 0
                ? "No TXT records yet at the challenge host — DNS propagation can take minutes to hours."
                : "TXT records exist but none match the challenge value exactly (quotes/spacing matter).",
          },
        },
        200
      );
  }
});

// Fresh challenge for expired domains (or deliberate token rotation).
domains.post("/:id/token", authMiddleware, async (c) => {
  const auth = requireProjectManagement(c);
  const id = c.req.param("id");
  const db = getDb();
  const result = await regenerateChallenge(db, auth.projectId, id);
  if (result.kind === "not_found") throw new AppError("not_found", "Domain not found", 404);
  if (result.kind === "verified") throw new AppError("conflict", "Domain is already verified", 409);
  const [row] = await db
    .select({ domain: domainsTable.domain })
    .from(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)))
    .limit(1);
  return c.json({
    data: {
      status: "pending",
      verification: {
        method: "dns_txt",
        host: `_calder.${row!.domain}`,
        value: `calder-verification=${result.token}`,
        expiresAt: result.expiresAt.toISOString(),
      },
    },
  });
});

domains.delete("/:id", authMiddleware, async (c) => {
  const auth = requireProjectManagement(c);
  const id = c.req.param("id");
  const db = getDb();
  const deleted = await db
    .delete(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)))
    .returning({ id: domainsTable.id });
  if (deleted.length === 0) throw new AppError("not_found", "Domain not found", 404);
  return c.json({ data: { id, deleted: true } });
});

/**
 * Authentication readiness: ownership, DKIM, SPF and DMARC as four separate
 * facts, with SPF and DMARC read live from DNS.
 *
 * Kept as a read: it changes nothing and rate-limits like a verification check
 * (it does real DNS work). Each fact carries the record we found and a sentence
 * explaining the failure, because "SPF: broken" without the published value is
 * a puzzle rather than a fix.
 */
domains.get("/:id/auth", authMiddleware, rateLimitMiddleware("verification"), async (c) => {
  const auth = requireProjectManagement(c);
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db
    .select()
    .from(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Domain not found", 404);

  const { checkDomainAuth } = await import("@calder/db");
  let auth_checks: Awaited<ReturnType<typeof checkDomainAuth>> | null = null;
  try {
    auth_checks = await checkDomainAuth(row.domain);
  } catch {
    auth_checks = null;
  }

  const unreachable = {
    state: "broken" as const,
    detail: "DNS could not be read just now, so this is unknown rather than passing.",
    found: [] as string[],
  };

  return c.json({
    data: {
      domain: row.domain,
      ownership: {
        state: row.status === "verified" ? "pass" : row.status === "pending" ? "missing" : "broken",
        detail:
          row.status === "verified"
            ? "This project proved control of the domain."
            : `Ownership is ${row.status}. Publish the _calder TXT record and verify again.`,
        found: row.verificationToken ? [`calder-verification=${row.verificationToken}`] : [],
      },
      dkim: {
        state:
          row.dkimStatus === "SUCCESS" || row.dkimStatus === "success"
            ? "pass"
            : row.dkimRecords && row.dkimRecords.length > 0
              ? "warning"
              : "missing",
        detail:
          row.dkimStatus === "SUCCESS" || row.dkimStatus === "success"
            ? "DKIM is verified: mail is cryptographically signed as this domain."
            : row.dkimRecords && row.dkimRecords.length > 0
              ? `DKIM is ${row.dkimStatus ?? "pending"}. Publish the three CNAME records and refresh.`
              : "No DKIM records yet. Link this domain to the sending provider first.",
        found: (row.dkimRecords ?? []).map((r) => `${r.name} ${r.type} ${r.value}`),
      },
      spf: auth_checks?.spf ?? unreachable,
      dmarc: auth_checks?.dmarc ?? unreachable,
    },
  });
});

// ---- M4.2: SES identity linkage + DKIM storage -----------------------------

/** Suggested SPF record (returned for display; tenants may already have one). */
const SPF_GUIDANCE = { type: "TXT" as const, value: "v=spf1 include:amazonses.com ~all" };

domains.post("/:id/ses/link", authMiddleware, async (c) => {
  const auth = requireProjectManagement(c);
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db
    .select()
    .from(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Domain not found", 404);
  if (row.status !== "verified")
    throw new AppError(
      "conflict",
      "Verify DNS ownership first (POST /v1/domains/:id/verify).",
      409
    );

  const { createSesDomainIdentity } = await import("@calder/providers");
  let link: { records: { name: string; type: string; value: string }[]; dkimStatus: string };
  try {
    link = await createSesDomainIdentity(row.domain);
  } catch (e) {
    // Provider exception text can contain credentials, request data, or
    // infrastructure details. Keep it in redacted operational telemetry only;
    // persist and return stable, non-sensitive classifications.
    const throttled = e instanceof Error && /throttl/i.test(e.message);
    logger.warn({ err: e, domainId: row.id }, "SES identity creation failed");
    await db
      .update(domainsTable)
      .set({
        sesIdentityStatus: "failed",
        lastVerifyError: throttled ? "throttled" : "provider_error",
        updatedAt: new Date(),
      })
      .where(and(eq(domainsTable.id, row.id), eq(domainsTable.projectId, auth.projectId)));
    if (throttled)
      throw new AppError(
        "rate_limit_error",
        "SES is throttling identity creation — retry shortly.",
        429
      );
    throw new AppError("provider_error", "SES identity creation failed. Try again later.", 502);
  }
  await db
    .update(domainsTable)
    .set({
      sesIdentityStatus: "pending",
      dkimStatus: link.dkimStatus,
      dkimRecords: link.records,
      updatedAt: new Date(),
    })
    .where(and(eq(domainsTable.id, row.id), eq(domainsTable.projectId, auth.projectId)));
  return c.json({
    data: {
      status: "pending",
      dkim: { status: link.dkimStatus, records: link.records },
      spf: { ...SPF_GUIDANCE, name: row.domain },
    },
  });
});

domains.post("/:id/ses/refresh", authMiddleware, async (c) => {
  const auth = requireProjectManagement(c);
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db
    .select()
    .from(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Domain not found", 404);
  if ((row.sesIdentityStatus ?? "not_linked") === "not_linked")
    throw new AppError("conflict", "Link SES first (POST /v1/domains/:id/ses/link).", 409);

  const { getSesDomainIdentity } = await import("@calder/providers");
  let snap: { verifiedForSending: boolean; dkimStatus: string };
  try {
    snap = await getSesDomainIdentity(row.domain);
  } catch (e) {
    logger.warn({ err: e, domainId: row.id }, "SES status poll failed");
    throw new AppError("provider_error", "SES status poll failed. Try again later.", 502);
  }
  const identityStatus = snap.verifiedForSending ? "verified" : "pending";
  await db
    .update(domainsTable)
    .set({ sesIdentityStatus: identityStatus, dkimStatus: snap.dkimStatus, updatedAt: new Date() })
    .where(and(eq(domainsTable.id, row.id), eq(domainsTable.projectId, auth.projectId)));
  return c.json({ data: { identityStatus, dkimStatus: snap.dkimStatus } });
});

export default domains;
