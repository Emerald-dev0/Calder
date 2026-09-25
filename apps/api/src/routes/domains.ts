import { Hono } from "hono";
import type { Env } from "../app.js";
import { createDomainSchema } from "@calder/validation";
import { authMiddleware } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { DnsVerificationProvider } from "@calder/email";
import { and, eq } from "drizzle-orm";
import { getDb, domains as domainsTable } from "@calder/db";
import { randomUUID } from "node:crypto";

const domains = new Hono<Env>();

domains.post("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createDomainSchema.safeParse(body);
  if (!parsed.success) throw new AppError("validation_error", "Invalid domain", 400, parsed.error.flatten());
  const db = getDb();
  const id = `dom_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const token = `calder_verify_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db.insert(domainsTable).values({ id, projectId: auth.projectId, domain: parsed.data.domain, status: "pending", verificationToken: token });
  return c.json({ data: { id, domain: parsed.data.domain, status: "pending", verification_token: token } }, 201);
});

domains.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const rows = await getDb().select().from(domainsTable).where(eq(domainsTable.projectId, auth.projectId));
  return c.json({ data: rows });
});

domains.post("/:id/verify", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const auth = c.get("auth" as never) as { projectId: string };
  const [row] = await getDb().select().from(domainsTable).where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId))).limit(1);
  if (!row) throw new AppError("not_found", "Domain not found", 404);
  const result = await new DnsVerificationProvider().verify(row.domain, row.verificationToken ?? "");
  if (!result.verified) {
    await getDb().update(domainsTable).set({ status: "pending", updatedAt: new Date() }).where(eq(domainsTable.id, id));
    throw new AppError("domain_not_verified", result.details ?? "TXT challenge not found", 422);
  }
  await getDb().update(domainsTable).set({ status: "verified", verifiedAt: new Date(), updatedAt: new Date() }).where(eq(domainsTable.id, id));
  return c.json({ data: { id, status: "verified", method: result.method } });
});

export default domains;
