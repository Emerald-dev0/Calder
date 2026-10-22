import { Hono } from "hono";
import type { Env } from "../app.js";
import { createSenderSchema, patchSenderSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";

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
    is_default_marketing: row.isDefaultMarketing ?? false,
    reply_to: row.replyTo ?? null,
    archived_at: row.archivedAt ?? null,
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
  const { and, desc, eq, lt, or } = await import("drizzle-orm");
  const db = getDb();
  const { isNull } = await import("drizzle-orm");
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const cursor = c.req.query("cursor");
  const includeArchived = c.req.query("include_archived") === "true";
  const conditions = [
    eq(senderIdentities.projectId, a.projectId),
    // Archived senders are hidden from pickers and listings by default; they
    // are only returned when a caller explicitly asks for them.
    ...(includeArchived ? [] : [isNull(senderIdentities.archivedAt)]),
  ];
  const position = decodeApiCursor(cursor);
  if (position) {
    conditions.push(
      or(
        lt(senderIdentities.createdAt, position.createdAt),
        and(
          eq(senderIdentities.createdAt, position.createdAt),
          lt(senderIdentities.id, position.id)
        )
      )!
    );
  }
  const rows = await db
    .select()
    .from(senderIdentities)
    .where(and(...conditions))
    .orderBy(desc(senderIdentities.createdAt), desc(senderIdentities.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null;
  return c.json({ data: page.map(present), pagination: { limit, next_cursor: nextCursor } });
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

  // Plan ceiling, checked immediately before the insert. Archived senders are
  // not counted, so retiring one frees the slot it held.
  const { assertCanCreateResource, organizationForProject, ResourceLimitError } = await import(
    "@calder/db"
  );
  const organizationId = await organizationForProject(db, a.projectId);
  if (!organizationId) throw new AppError("not_found", "Project not found", 404);
  try {
    await assertCanCreateResource(db, organizationId, "senders");
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
          ? `Upgrade to ${err.upgradeDisplayName} to add more sender identities.`
          : undefined
      );
    }
    throw err;
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

// PATCH /v1/senders/:id (display_name, is_default, is_default_marketing, reply_to)
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
  if (existing.archivedAt) {
    throw new AppError(
      "sender_not_ready",
      "This sender is archived. Unarchive it before editing.",
      422,
      undefined,
      "POST /v1/senders/:id/unarchive, then retry."
    );
  }

  const wantsTransactional = parsed.data.is_default === true;
  const wantsMarketing = parsed.data.is_default_marketing === true;
  const usable = existing.status === "verified" || existing.status === "connected";
  if ((wantsTransactional || wantsMarketing) && !usable) {
    throw new AppError(
      "sender_not_ready",
      `${existing.email} is ${existing.status}. Only a verified sender can be a default.`,
      422,
      undefined,
      "Verify the sender's domain first."
    );
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.display_name !== undefined) {
    set.displayName = parsed.data.display_name.trim().slice(0, 255);
  }
  if (parsed.data.is_default !== undefined) set.isDefault = parsed.data.is_default;
  if (parsed.data.is_default_marketing !== undefined) {
    set.isDefaultMarketing = parsed.data.is_default_marketing;
  }
  if (parsed.data.reply_to !== undefined) {
    const replyTo = (parsed.data.reply_to ?? "").trim().toLowerCase();
    set.replyTo = replyTo || null;
  }

  const updated = await db.transaction(async (tx) => {
    // One default per project per stream: clear the current holder before
    // promoting a new one, inside the same transaction so a reader never sees
    // two marketing defaults (the partial unique index would refuse anyway).
    if (wantsTransactional) {
      await tx
        .update(senderIdentities)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(senderIdentities.projectId, a.projectId));
    }
    if (wantsMarketing) {
      await tx
        .update(senderIdentities)
        .set({ isDefaultMarketing: false, updatedAt: new Date() })
        .where(eq(senderIdentities.projectId, a.projectId));
    }
    const [row] = await tx
      .update(senderIdentities)
      .set(set)
      .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
      .returning();
    return row;
  });
  return c.json({ data: present(updated as Record<string, unknown>) });
});

// DELETE /v1/senders/:id
//
// A sender that has ever produced a message is archived rather than deleted:
// the email history is the record of who sent what, and the FK is `set null`,
// so a hard delete would silently strip that attribution. A sender with no
// history is genuinely deleted.
senders.delete("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, senderIdentities, emails } = await import("@calder/db");
  const { eq, and, count } = await import("drizzle-orm");
  const db = getDb();
  const [existing] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .limit(1);
  if (!existing) throw new AppError("not_found", "Sender not found", 404);

  if (existing.archivedAt) {
    return c.json({ data: { id, deleted: false, archived: true, archived_at: existing.archivedAt } });
  }

  const [row] = await db
    .select({ value: count() })
    .from(emails)
    .where(and(eq(emails.senderIdentityId, id), eq(emails.projectId, a.projectId)));
  const emailCount = Number(row?.value ?? 0);

  if (emailCount > 0) {
    const [archived] = await db
      .update(senderIdentities)
      .set({
        archivedAt: new Date(),
        // An archived sender cannot remain a default: the send path would
        // otherwise resolve an address nobody can select any more.
        isDefault: false,
        isDefaultMarketing: false,
        updatedAt: new Date(),
      })
      .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
      .returning();
    return c.json({
      data: {
        id,
        deleted: false,
        archived: true,
        archived_at: archived?.archivedAt ?? null,
        email_count: emailCount,
      },
    });
  }

  await db
    .delete(senderIdentities)
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)));
  return c.json({ data: { id, deleted: true, archived: false } });
});

// POST /v1/senders/:id/unarchive — make an archived sender selectable again.
senders.post("/:id/unarchive", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, senderIdentities } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [updated] = await db
    .update(senderIdentities)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
    .returning();
  if (!updated) throw new AppError("not_found", "Sender not found", 404);
  return c.json({ data: present(updated as Record<string, unknown>) });
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
  if (existing.archivedAt) {
    throw new AppError(
      "sender_not_ready",
      "An archived sender cannot be a default.",
      422,
      undefined,
      "Unarchive it first."
    );
  }
  if (existing.status !== "verified" && existing.status !== "connected") {
    throw new AppError(
      "sender_not_ready",
      `${existing.email} is ${existing.status}. Only a verified sender can be a default.`,
      422,
      undefined,
      "Verify the sender's domain first."
    );
  }
  await db
    .update(senderIdentities)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(senderIdentities.projectId, a.projectId));
  const [updated] = await db
    .update(senderIdentities)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, a.projectId)))
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
  const { withOrganizationSendingEligibility } = await import("@calder/db");
  const admission = await withOrganizationSendingEligibility(
    db,
    { organizationId: a.organizationId, projectId: a.projectId, env: a.env },
    async (tx) => {
      await tx.insert(emails).values({
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
        // /v1/emails/batch do; test traffic is never metered as live.
        env: a.env,
      });
      await tx.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId,
        projectId: a.projectId,
        type: "queued",
        data: { via: "api-test-send", env: a.env },
      });
      return true;
    }
  );
  const { assertOrganizationAdmissionAllowed } = await import("../lib/organization-sending.js");
  assertOrganizationAdmissionAllowed(admission.decision);
  await createQueue<{ emailId: string; projectId: string }>("email:send", {
    maxAttempts: 5,
  }).enqueue("send-email", { emailId, projectId: a.projectId });
  return c.json({ data: { id: emailId, status: "queued" } }, 202);
});

export default senders;
