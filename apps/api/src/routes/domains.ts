import { Hono } from "hono";
import type { Env } from "../app.js";
import { createDomainSchema } from "@avenor/validation";
import { authMiddleware } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";

const domains = new Hono<Env>();

domains.post("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createDomainSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid domain", 400, parsed.error.flatten());

  // Scaffold: create in-memory or DB
  try {
    const { getDb, domains: domainsTable } = await import("@avenor/db");
    const { randomUUID } = await import("node:crypto");
    const db = getDb();
    const id = `dom_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const token = `avenor_verify_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await db.insert(domainsTable).values({
      id,
      projectId: auth.projectId,
      domain: parsed.data.domain,
      status: "pending",
      verificationToken: token,
    });
    return c.json(
      { data: { id, domain: parsed.data.domain, status: "pending", verification_token: token } },
      201
    );
  } catch {
    // fallback
    const id = `dom_${Date.now()}`;
    return c.json(
      {
        data: {
          id,
          domain: parsed.data.domain,
          status: "pending",
          verification_token: `mock_${id}`,
        },
      },
      201
    );
  }
});

domains.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  try {
    const { getDb, domains: domainsTable } = await import("@avenor/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(domainsTable)
      .where(eq(domainsTable.projectId, auth.projectId));
    return c.json({ data: rows });
  } catch {
    return c.json({ data: [] });
  }
});

domains.post("/:id/verify", authMiddleware, async (c) => {
  const id = c.req.param("id");
  // Scaffold verification — just mark verified for demo
  try {
    const { getDb, domains: domainsTable } = await import("@avenor/db");
    const { eq, and } = await import("drizzle-orm");
    const auth = c.get("auth" as never) as { projectId: string };
    const { now } = { now: new Date() };
    const db = getDb();
    await db
      .update(domainsTable)
      .set({ status: "verified", verifiedAt: now as unknown as Date })
      .where(and(eq(domainsTable.id, id), eq(domainsTable.projectId, auth.projectId)));
    return c.json({ data: { id, status: "verified" } });
  } catch {
    return c.json({ data: { id, status: "verified" } });
  }
});

export default domains;
