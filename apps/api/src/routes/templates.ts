import { Hono } from "hono";
import type { Env } from "../app.js";
import { createTemplateSchema, createTemplateVersionSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";

const templates = new Hono<Env>();

function auth(c: { get: (k: string) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

function present(t: Record<string, unknown>, latest: Record<string, unknown> | null) {
  return {
    id: t.id,
    object: "template",
    name: t.name,
    alias: t.alias ?? null,
    description: t.description ?? null,
    latest_version: latest
      ? {
          version: latest.version,
          subject: latest.subject ?? null,
          has_html: !!latest.html,
          has_text: !!latest.text,
          created_at: latest.createdAt,
        }
      : null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

async function latestVersion(
  db: import("@calder/db").DbClient,
  templateId: string,
  projectId: string
): Promise<Record<string, unknown> | null> {
  const { templateVersions, templates } = await import("@calder/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({
      version: templateVersions.version,
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      createdAt: templateVersions.createdAt,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(and(eq(templateVersions.templateId, templateId), eq(templates.projectId, projectId)))
    .orderBy(desc(templateVersions.createdAt))
    .limit(1);
  return (row as Record<string, unknown> | undefined) ?? null;
}

// GET /v1/templates
templates.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  const { getDb, templates: templatesTable } = await import("@calder/db");
  const { and, desc, eq, lt, or } = await import("drizzle-orm");
  const db = getDb();
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const cursor = c.req.query("cursor");
  const conditions = [eq(templatesTable.projectId, a.projectId)];
  const position = decodeApiCursor(cursor);
  if (position) {
    conditions.push(
      or(
        lt(templatesTable.createdAt, position.createdAt),
        and(eq(templatesTable.createdAt, position.createdAt), lt(templatesTable.id, position.id))
      )!
    );
  }
  const rows = await db
    .select()
    .from(templatesTable)
    .where(and(...conditions))
    .orderBy(desc(templatesTable.createdAt), desc(templatesTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const out = [];
  for (const t of page) {
    out.push(present(t as Record<string, unknown>, await latestVersion(db, t.id, a.projectId)));
  }
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null;
  return c.json({ data: out, pagination: { limit, next_cursor: nextCursor } });
});

// POST /v1/templates (creates v1 when content is provided)
templates.post("/", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid template", 400, parsed.error.flatten());

  const { getDb, templates: templatesTable, templateVersions } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const alias = parsed.data.alias?.toLowerCase();
  if (alias) {
    const [taken] = await db
      .select({ id: templatesTable.id })
      .from(templatesTable)
      .where(and(eq(templatesTable.projectId, a.projectId), eq(templatesTable.alias, alias)))
      .limit(1);
    if (taken)
      throw new AppError("conflict", `Alias "${alias}" is already in use on this project.`, 409);
  }
  const id = `tpl_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const [created] = await db
    .insert(templatesTable)
    .values({
      id,
      projectId: a.projectId,
      name: parsed.data.name.trim().slice(0, 255),
      alias: alias ?? null,
      description: parsed.data.description?.slice(0, 2000) ?? null,
    })
    .returning();
  let latest: Record<string, unknown> | null = null;
  if (parsed.data.subject || parsed.data.html || parsed.data.text) {
    const [v] = await db
      .insert(templateVersions)
      .values({
        id: `tv_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        templateId: id,
        version: "v1",
        subject: parsed.data.subject ?? null,
        html: parsed.data.html ?? null,
        text: parsed.data.text ?? null,
      })
      .returning();
    latest = v as Record<string, unknown>;
  }
  return c.json({ data: present(created as Record<string, unknown>, latest) }, 201);
});

// GET /v1/templates/:id
templates.get("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  const id = c.req.param("id");
  const { getDb, templates: templatesTable } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [row] = await db
    .select()
    .from(templatesTable)
    .where(and(eq(templatesTable.id, id), eq(templatesTable.projectId, a.projectId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Template not found", 404);
  return c.json({
    data: present(row as Record<string, unknown>, await latestVersion(db, id, a.projectId)),
  });
});

// DELETE /v1/templates/:id
templates.delete("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, templates: templatesTable } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const deleted = await db
    .delete(templatesTable)
    .where(and(eq(templatesTable.id, id), eq(templatesTable.projectId, a.projectId)))
    .returning({ id: templatesTable.id });
  if (deleted.length === 0) throw new AppError("not_found", "Template not found", 404);
  return c.json({ data: { id, deleted: true } });
});

// GET /v1/templates/:id/versions
templates.get("/:id/versions", authMiddleware, async (c) => {
  const a = auth(c);
  const id = c.req.param("id");
  const { getDb, templates: templatesTable, templateVersions } = await import("@calder/db");
  const { eq, and, desc, lt, or } = await import("drizzle-orm");
  const db = getDb();
  const [t] = await db
    .select({ id: templatesTable.id })
    .from(templatesTable)
    .where(and(eq(templatesTable.id, id), eq(templatesTable.projectId, a.projectId)))
    .limit(1);
  if (!t) throw new AppError("not_found", "Template not found", 404);
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const position = decodeApiCursor(c.req.query("cursor"));
  const conditions = [
    eq(templateVersions.templateId, id),
    eq(templatesTable.projectId, a.projectId),
  ];
  if (position) {
    conditions.push(
      or(
        lt(templateVersions.createdAt, position.createdAt),
        and(
          eq(templateVersions.createdAt, position.createdAt),
          lt(templateVersions.id, position.id)
        )
      )!
    );
  }
  const versions = await db
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      subject: templateVersions.subject,
      has_html: templateVersions.html,
      has_text: templateVersions.text,
      created_at: templateVersions.createdAt,
    })
    .from(templateVersions)
    .innerJoin(templatesTable, eq(templateVersions.templateId, templatesTable.id))
    .where(and(...conditions))
    .orderBy(desc(templateVersions.createdAt), desc(templateVersions.id))
    .limit(limit + 1);
  const hasMore = versions.length > limit;
  const page = hasMore ? versions.slice(0, limit) : versions;
  const last = page[page.length - 1];
  return c.json({
    data: page.map((v) => ({
      version: v.version,
      subject: v.subject ?? null,
      has_html: !!v.has_html,
      has_text: !!v.has_text,
      created_at: v.created_at,
    })),
    pagination: {
      limit,
      next_cursor: hasMore && last ? encodeApiCursor(last.created_at, last.id) : null,
    },
  });
});

// POST /v1/templates/:id/versions (auto-numbers vN; rollback = post old content)
templates.post("/:id/versions", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createTemplateVersionSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid version", 400, parsed.error.flatten());
  if (!parsed.data.subject && !parsed.data.html && !parsed.data.text) {
    throw validationError("Provide at least one of subject, html, text.");
  }

  const { getDb, templates: templatesTable, templateVersions } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const { eq, and, sql } = await import("drizzle-orm");
  const db = getDb();
  const [t] = await db
    .select({ id: templatesTable.id })
    .from(templatesTable)
    .where(and(eq(templatesTable.id, id), eq(templatesTable.projectId, a.projectId)))
    .limit(1);
  if (!t) throw new AppError("not_found", "Template not found", 404);
  const [countRow] = await db
    .select({ value: sql<number>`count(*)` })
    .from(templateVersions)
    .innerJoin(templatesTable, eq(templateVersions.templateId, templatesTable.id))
    .where(and(eq(templateVersions.templateId, id), eq(templatesTable.projectId, a.projectId)));
  const n = countRow?.value ?? 0;
  const [v] = await db
    .insert(templateVersions)
    .values({
      id: `tv_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      templateId: id,
      version: `v${Number(n ?? 0) + 1}`,
      subject: parsed.data.subject ?? null,
      html: parsed.data.html ?? null,
      text: parsed.data.text ?? null,
    })
    .returning();
  return c.json(
    {
      data: {
        version: (v as Record<string, unknown>).version,
        subject: (v as Record<string, unknown>).subject ?? null,
        created_at: (v as Record<string, unknown>).createdAt,
      },
    },
    201
  );
});

export default templates;
