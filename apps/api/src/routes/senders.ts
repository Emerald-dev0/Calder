import { Hono } from "hono";
import type { Env } from "../app.js";
import { createSenderSchema, patchSenderSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";

const senders = new Hono<Env>();

function auth(c: { get: (k: string) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

/** Serialize without secrets. Transports are referenced by id only. */
function present(row: Record<string, unknown>) {
  return {
    id: row.id,
    object: "sender",
    project_id: row.projectId,
    display_name: row.displayName,
    email: row.email,
    type: row.type,
    status: row.status,
    status_reason: row.statusReason ?? null,
    is_default: row.isDefault,
    transport_id: row.transportId ?? null,
    last_used_at: row.lastUsedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// GET /v1/senders, list this project's sender identities
senders.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  const { getDb, senderIdentities } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const rows = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.projectId, a.projectId));
  return c.json({ data: rows.map(present) });
});

// POST /v1/senders, create (domain senders need a verified domain; gmail
// senders need an active transport — enforced here, never trusted from UI)
senders.post("/", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createSenderSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid sender", 400, parsed.error.flatten());

  const { getDb, senderIdentities, domains, projectTransports } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const { display_name, email, type, transport_id } = parsed.data;
  const normalized = email.trim().toLowerCase();

  let status: "verified" | "connected" | "pending" = "pending";
  let transportId: string | null = null;
  if (type === "domain") {
    const domain = normalized.split("@")[1] ?? "";
    const [row] = await db
      .select()
      .from(domains)
      .where(and(eq(domains.projectId, a.projectId), eq(domains.domain, domain)))
      .limit(1);
    if (!row || row.status !== "verified") {
      throw new AppError(
        "domain_not_verified",
        `Verify ${domain} before creating senders on it.`,
        422,
        undefined,
        `Add ${domain} via POST /v1/domains, add the DNS records, then verify.`
      );
    }
    status = "verified";
  } else if (type === "gmail") {
    if (!transport_id) throw validationError("transport_id is required for gmail senders");
    const [t] = await db
      .select()
      .from(projectTransports)
      .where(
        and(eq(projectTransports.id, transport_id), eq(projectTransports.projectId, a.projectId))
      )
      .limit(1);
    if (!t || t.type !== "gmail" || t.status !== "active") {
      throw new AppError(
        "sender_not_ready",
        "That Gmail connection is no longer active. Reconnect it first.",
        422,
        undefined,
        "Reconnect Gmail for this project, then retry with the new transport id."
      );
    }
    status = "connected";
    transportId = t.id;
  }

  const id = `sender_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  try {
    const [created] = await db
      .insert(senderIdentities)
      .values({
        id,
        projectId: a.projectId,
        displayName: display_name.trim().slice(0, 255),
        email: normalized,
        type,
        transportId,
        status,
      })
      .returning();
    return c.json({ data: present(created as Record<string, unknown>) }, 201);
  } catch {
    throw new AppError(
      "conflict",
      "That address is already a sender on this project.",
      409,
      undefined,
      "List GET /v1/senders to see the existing identity."
    );
  }
});

// GET /v1/senders/:id
senders.get("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  const id = c.req.param("id");
  const { getDb, senderIdentities } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [row] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Sender not found", 404);
  return c.json({ data: present(row as Record<string, unknown>) });
});

// PATCH /v1/senders/:id (display_name, is_default)
senders.patch("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = patchSenderSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid sender update", 400, parsed.error.flatten());

  const { getDb, senderIdentities } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [existing] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .limit(1);
  if (!existing) throw new AppError("not_found", "Sender not found", 404);

  if (parsed.data.is_default) {
    await db
      .update(senderIdentities)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(senderIdentities.projectId, a.projectId));
  }
  const [updated] = await db
    .update(senderIdentities)
    .set({
      ...(parsed.data.display_name !== undefined
        ? { displayName: parsed.data.display_name.trim().slice(0, 255) }
        : {}),
      ...(parsed.data.is_default !== undefined ? { isDefault: parsed.data.is_default } : {}),
      updatedAt: new Date(),
    })
    .where(eq(senderIdentities.id, id))
    .returning();
  return c.json({ data: present(updated as Record<string, unknown>) });
});

// DELETE /v1/senders/:id (deliveries keep records, FK set null)
senders.delete("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, senderIdentities } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const deleted = await db
    .delete(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .returning({ id: senderIdentities.id });
  if (deleted.length === 0) throw new AppError("not_found", "Sender not found", 404);
  return c.json({ data: { id, deleted: true } });
});

// POST /v1/senders/:id/default
senders.post("/:id/default", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, senderIdentities } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [existing] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .limit(1);
  if (!existing) throw new AppError("not_found", "Sender not found", 404);
  await db
    .update(senderIdentities)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(senderIdentities.projectId, a.projectId));
  const [updated] = await db
    .update(senderIdentities)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(senderIdentities.id, id))
    .returning();
  return c.json({ data: present(updated as Record<string, unknown>) });
});

// POST /v1/senders/:id/test { to } — acceptance only, never claims delivery
senders.post("/:id/test", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "send");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const to = String(body?.to ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{2,}$/.test(to)) {
    throw validationError("Provide a valid recipient address in { to }.");
  }
  const { getDb, senderIdentities, emails, emailEvents } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const { eq, and } = await import("drizzle-orm");
  const { createQueue } = await import("@calder/queue");
  const db = getDb();
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .limit(1);
  if (!sender) throw new AppError("not_found", "Sender not found", 404);
  if (sender.status !== "verified" && sender.status !== "connected") {
    throw new AppError(
      "sender_not_ready",
      `${sender.email} isn't ready (status: ${sender.status}).`,
      422,
      undefined,
      "Verify or reconnect this sender before test sends."
    );
  }
  const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(emails).values({
    id: emailId,
    projectId: a.projectId,
    from: sender.email,
    senderIdentityId: sender.id,
    fromName: sender.displayName,
    to,
    subject: `Test send from ${sender.displayName}`,
    text: `This is a test send from ${sender.displayName} <${sender.email}> via Calder.`,
    status: "queued",
    // Inherit the credential's environment, like /v1/emails and
    // /v1/emails/batch do. Without this the row defaulted to "live", so a
    // test-mode key ran a real SES send and metered it as live usage.
    env: a.env,
  });
  await db.insert(emailEvents).values({
    id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    emailId,
    projectId: a.projectId,
    type: "queued",
    data: { via: "api-test-send" },
  });
  await createQueue<{ emailId: string; projectId: string }>("email:send", {
    maxAttempts: 5,
  }).enqueue("send-email", { emailId, projectId: a.projectId });
  return c.json({ data: { id: emailId, status: "queued" } }, 202);
});

export default senders;
