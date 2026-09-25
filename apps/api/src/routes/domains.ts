import { Hono } from "hono";
import type { Env } from "../app.js";
import { createDomainSchema } from "@calder/validation";
import { authMiddleware } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { getDb, domains as domainsTable } from "@calder/db";
import { and, eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  attemptVerification,
  createChallenge,
  publicDomainProjection,
  regenerateChallenge,
  sweepExpiredChallenges,
} from "../lib/domain-verification.js";

const domains = new Hono<Env>();

domains.post("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createDomainSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid domain", 400, parsed.error.flatten());

  const db = getDb();
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

domains.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const db = getDb();
  await sweepExpiredChallenges(db, auth.projectId);
  const rows = await db
    .select()
    .from(domainsTable)
    .where(eq(domainsTable.projectId, auth.projectId))
    .orderBy(desc(domainsTable.createdAt));
  return c.json({ data: rows.map(publicDomainProjection) });
});

domains.post("/:id/verify", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const id = c.req.param("id");
  const db = getDb();
  const outcome = await attemptVerification(db, auth.projectId, id);
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
  const auth = c.get("auth" as never) as { projectId: string };
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
  const auth = c.get("auth" as never) as { projectId: string };
  const id = c.req.param("id");
  const db = getDb();
  const deleted = await db
    .delete(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)))
    .returning({ id: domainsTable.id });
  if (deleted.length === 0) throw new AppError("not_found", "Domain not found", 404);
  return c.json({ data: { id, deleted: true } });
});

// ---- M4.2: SES identity linkage + DKIM storage -----------------------------

/** Suggested SPF record (returned for display; tenants may already have one). */
const SPF_GUIDANCE = { type: "TXT" as const, value: "v=spf1 include:amazonses.com ~all" };

domains.post("/:id/ses/link", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
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
    const msg = e instanceof Error ? e.message : "SES linkage failed";
    await db
      .update(domainsTable)
      .set({ sesIdentityStatus: "failed", lastVerifyError: msg, updatedAt: new Date() })
      .where(eq(domainsTable.id, row.id));
    if (/throttl/i.test(msg))
      throw new AppError(
        "rate_limit_error",
        "SES is throttling identity creation — retry shortly.",
        429
      );
    throw new AppError("provider_error", `SES identity creation failed: ${msg}`, 502);
  }
  await db
    .update(domainsTable)
    .set({
      sesIdentityStatus: "pending",
      dkimStatus: link.dkimStatus,
      dkimRecords: link.records,
      updatedAt: new Date(),
    })
    .where(eq(domainsTable.id, row.id));
  return c.json({
    data: {
      status: "pending",
      dkim: { status: link.dkimStatus, records: link.records },
      spf: { ...SPF_GUIDANCE, name: row.domain },
    },
  });
});

domains.post("/:id/ses/refresh", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
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
    const msg = e instanceof Error ? e.message : "SES status poll failed";
    throw new AppError("provider_error", `SES status poll failed: ${msg}`, 502);
  }
  const identityStatus = snap.verifiedForSending ? "verified" : "pending";
  await db
    .update(domainsTable)
    .set({ sesIdentityStatus: identityStatus, dkimStatus: snap.dkimStatus, updatedAt: new Date() })
    .where(eq(domainsTable.id, row.id));
  return c.json({ data: { identityStatus, dkimStatus: snap.dkimStatus } });
});

export default domains;
