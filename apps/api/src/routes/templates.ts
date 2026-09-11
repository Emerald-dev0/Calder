import { Hono } from "hono";
import type { Env } from "../app.js";
import { createTemplateSchema, createTemplateVersionSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";

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
  templateId: string
): Promise<Record<string, unknown> | null> {
  const { templateVersions } = await import("@calder/db");
  const { eq, desc } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.createdAt))
    .limit(1);
  return (row as Record<string, unknown> | undefined) ?? null;
}

// GET /v1/templates
templates.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  const { getDb, templates: templatesTable } = await import("@calder/db");
  const { eq, desc } = await import("drizzle-orm");
  const db = getDb();
  const rows = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.projectId, a.projectId))
    .orderBy(desc(templatesTable.createdAt));
  const out = [];
  for (const t of rows) {
    out.push(present(t as Record<string, unknown>, await latestVersion(db, t.id)));
  }
  return c.json({ data: out });
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
  return c.json({ data: present(row as Record<string, unknown>, await latestVersion(db, id)) });
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
  const { eq, and, desc } = await import("drizzle-orm");
  const db = getDb();
  const [t] = await db
    .select({ id: templatesTable.id })
    .from(templatesTable)
    .where(and(eq(templatesTable.id, id), eq(templatesTable.projectId, a.projectId)))
    .limit(1);
  if (!t) throw new AppError("not_found", "Template not found", 404);
  const versions = await db
    .select({
      version: templateVersions.version,
      subject: templateVersions.subject,
      has_html: templateVersions.html,
      has_text: templateVersions.text,
      created_at: templateVersions.createdAt,
    })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, id))
    .orderBy(desc(templateVersions.createdAt));
  return c.json({
    data: versions.map((v) => ({
      version: v.version,
      subject: v.subject ?? null,
      has_html: !!v.has_html,
      has_text: !!v.has_text,
      created_at: v.created_at,
    })),
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
    .where(eq(templateVersions.templateId, id));
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
