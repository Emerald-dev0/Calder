import { Hono } from "hono";
import type { Env } from "../app.js";
import { createTemplateSchema, createTemplateVersionSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { AppError, validationError } from "../errors/index.js";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";

const templates = new Hono<Env>();

function auth(c: { get: (k: string) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

function versionSummary(v: Record<string, unknown> | null) {
  if (!v) return null;
  return {
    version: v.version,
    status: v.status === "draft" ? "draft" : "published",
    subject: v.subject ?? null,
    has_html: !!v.html,
    has_text: !!v.text,
    variables: (v.variables as unknown) ?? [],
    published_at: v.publishedAt ?? null,
    created_at: v.createdAt,
  };
}

function present(t: Record<string, unknown>, latest: Record<string, unknown> | null) {
  return {
    id: t.id,
    object: "template",
    name: t.name,
    alias: t.alias ?? null,
    description: t.description ?? null,
    // Newest version of any status: this is what the editor is editing.
    latest_version: versionSummary(latest),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/**
 * The two versions that matter to a caller.
 *
 * `published` is what sends resolve — and it is null until someone publishes,
 * which is the whole point of the lifecycle. `draft` is the newest unpublished
 * version, shown so an operator can see that an edit is waiting.
 */
async function sendableState(
  db: import("@calder/db").DbClient,
  templateId: string,
  projectId: string
) {
  const { templateVersions, templates } = await import("@calder/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      version: templateVersions.version,
      status: templateVersions.status,
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      variables: templateVersions.variables,
      publishedAt: templateVersions.publishedAt,
      createdAt: templateVersions.createdAt,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(and(eq(templateVersions.templateId, templateId), eq(templates.projectId, projectId)))
    .orderBy(desc(templateVersions.createdAt));

  const published = rows.filter((r) => r.status === "published");
  const newestPublished = published.reduce<(typeof published)[number] | null>((best, row) => {
    if (!best) return row;
    const a = best.publishedAt?.getTime() ?? 0;
    const b = row.publishedAt?.getTime() ?? 0;
    return b > a ? row : best;
  }, null);
  const draft = rows.find((r) => r.status === "draft") ?? null;
  return {
    published: newestPublished ? versionSummary(newestPublished as Record<string, unknown>) : null,
    draft: draft ? versionSummary(draft as Record<string, unknown>) : null,
    all: rows,
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
      status: templateVersions.status,
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      variables: templateVersions.variables,
      publishedAt: templateVersions.publishedAt,
      createdAt: templateVersions.createdAt,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(and(eq(templateVersions.templateId, templateId), eq(templates.projectId, projectId)))
    .orderBy(desc(templateVersions.createdAt))
    .limit(1);
  return (row as Record<string, unknown> | undefined) ?? null;
}

/**
 * React Email input.
 *
 * We accept the element **tree** as data and render it here; we never accept
 * React source text. Compiling customer source server-side would run their code
 * beside every tenant's data and provider credentials, which a template does not
 * justify. The tree renders through a fixed component map, and the result is
 * stored as ordinary html/text on the version — no components reach send time.
 */
async function reactTreeContent(
  body: unknown
): Promise<{ html: string | null; text: string | null } | null> {
  const raw = body as { react_tree?: unknown; react_source?: unknown };
  if (raw?.react_source !== undefined) {
    throw new AppError(
      "validation_error",
      "react_source is not accepted: Calder does not execute customer-supplied code.",
      400,
      undefined,
      "Render it in your own build and send html/text, or send react_tree (an element tree) and we will render it."
    );
  }
  if (raw?.react_tree === undefined || raw.react_tree === null) return null;
  const { parseReactTree, renderReactTree, ReactTreeError } = await import("@calder/email");
  try {
    const rendered = renderReactTree(parseReactTree(raw.react_tree));
    return { html: rendered.html, text: rendered.text };
  } catch (err) {
    if (err instanceof ReactTreeError) {
      throw new AppError(
        "validation_error",
        `react_tree could not be rendered: ${err.message}`,
        400,
        { path: err.path }
      );
    }
    throw err;
  }
}

// GET /v1/templates
templates.get("/", authMiddleware, rateLimitMiddleware("read"), async (c) => {
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
    const state = await sendableState(db, t.id, a.projectId);
    out.push({
      ...present(t as Record<string, unknown>, await latestVersion(db, t.id, a.projectId)),
      published_version: state.published,
      draft_version: state.draft,
    });
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
  const fromTree = await reactTreeContent(body);
  if (fromTree) {
    parsed.data.html = fromTree.html ?? undefined;
    parsed.data.text = fromTree.text ?? undefined;
  }
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
  const state = await sendableState(db, id, a.projectId);
  return c.json({
    data: {
      ...present(row as Record<string, unknown>, await latestVersion(db, id, a.projectId)),
      published_version: state.published,
      draft_version: state.draft,
    },
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
  const { extractVariables, normaliseVariables, validateForPublish } =
    await import("@calder/email");

  // Declared variables: an explicit declaration is honoured (and enforced by
  // publish-time validation). Omitting it means "infer from the template",
  // which is what a caller sending `{{name}}` without ceremony expects — the
  // strict check exists to catch a *mismatch* between what a template says and
  // what its author claimed, not to punish omission.
  const rawVariables = (body as { variables?: unknown }).variables;
  const declared =
    rawVariables === undefined
      ? normaliseVariables(
          extractVariables(parsed.data.subject, parsed.data.html, parsed.data.text)
        )
      : normaliseVariables(rawVariables);
  const publishNow = (body as { publish?: unknown }).publish === true;
  const fromTree = await reactTreeContent(body);
  const content = {
    subject: parsed.data.subject ?? null,
    html: fromTree ? fromTree.html : (parsed.data.html ?? null),
    text: fromTree ? fromTree.text : (parsed.data.text ?? null),
  };

  if (publishNow) {
    // Publishing while saving is allowed, but only if the version would be
    // sendable: the alternative is a "publish" that fails later, per recipient.
    const problems = validateForPublish(content, declared);
    if (problems.length > 0) {
      throw new AppError(
        "validation_error",
        `This version cannot be published: ${problems.map((p) => p.message).join(" ")}`,
        400,
        { problems },
        "Fix the problems, or save it as a draft."
      );
    }
  }

  const [v] = await db
    .insert(templateVersions)
    .values({
      id: `tv_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      templateId: id,
      version: `v${Number(n ?? 0) + 1}`,
      subject: content.subject,
      html: content.html,
      text: content.text,
      status: publishNow ? "published" : "draft",
      publishedAt: publishNow ? new Date() : null,
      variables: declared,
    })
    .returning();
  return c.json(
    {
      data: {
        version: (v as Record<string, unknown>).version,
        status: publishNow ? "published" : "draft",
        subject: (v as Record<string, unknown>).subject ?? null,
        variables: declared,
        created_at: (v as Record<string, unknown>).createdAt,
      },
    },
    201
  );
});

/** Load one version of a template, tenant-scoped. */
async function loadVersion(
  db: import("@calder/db").DbClient,
  templateId: string,
  projectId: string,
  version: string
) {
  const { templateVersions, templates } = await import("@calder/db");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      status: templateVersions.status,
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      variables: templateVersions.variables,
      publishedAt: templateVersions.publishedAt,
      createdAt: templateVersions.createdAt,
      projectId: templates.projectId,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(
      and(
        eq(templateVersions.templateId, templateId),
        eq(templates.projectId, projectId),
        eq(templateVersions.version, version)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * The "copy AI prompt" text for this template.
 *
 * Built only from facts we hold (name, alias, subject, bodies, declared
 * variables, sending domain), so it is deterministic and cannot tell an
 * assistant to use a variable the template will not be given.
 */
templates.get("/:id/prompt", authMiddleware, rateLimitMiddleware("read"), async (c) => {
  const a = auth(c);
  const {
    getDb,
    templates: templatesTable,
    templateVersions,
    domains,
  } = await import("@calder/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const db = getDb();
  const [row] = await db
    .select()
    .from(templatesTable)
    .where(and(eq(templatesTable.id, c.req.param("id")), eq(templatesTable.projectId, a.projectId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Template not found", 404);

  const [version] = await db
    .select({
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      variables: templateVersions.variables,
    })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, row.id))
    .orderBy(desc(templateVersions.createdAt))
    .limit(1);

  const [verified] = await db
    .select({ domain: domains.domain })
    .from(domains)
    .where(and(eq(domains.projectId, a.projectId), eq(domains.status, "verified")))
    .limit(1);

  const { buildTemplatePrompt, extractVariables, normaliseVariables } =
    await import("@calder/email");
  const declared = normaliseVariables(version?.variables);
  const prompt = buildTemplatePrompt({
    name: row.name,
    alias: row.alias ?? null,
    subject: version?.subject ?? null,
    description: row.description ?? null,
    hasHtml: Boolean(version?.html),
    hasText: Boolean(version?.text),
    variables:
      declared.length > 0
        ? declared
        : normaliseVariables(extractVariables(version?.subject, version?.html, version?.text)),
    sendingDomain: verified?.domain ?? null,
  });
  return c.json({ data: { template_id: row.id, prompt } });
});

/**
 * Preview a version with sample data.
 *
 * Returns both the rendered output and the publish problems, so the editor can
 * show "this is what recipients see" and "this is what would stop it" in one
 * round trip. Drafts are previewable — that is the point of a draft.
 */
templates.post("/:id/versions/:version/preview", authMiddleware, async (c) => {
  const a = auth(c);
  const db = (await import("@calder/db")).getDb();
  const row = await loadVersion(db, c.req.param("id"), a.projectId, c.req.param("version"));
  if (!row) throw new AppError("not_found", "Template version not found", 404);

  const body = (await c.req.json().catch(() => null)) ?? {};
  const variables = ((body as { variables?: unknown }).variables ?? {}) as Record<string, string>;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === "string") clean[key] = value;
  }

  const { renderTemplate, validateForPublish, normaliseVariables } = await import("@calder/email");
  const content = { subject: row.subject, html: row.html, text: row.text };
  const rendered = renderTemplate(content, clean);
  const declared = normaliseVariables(row.variables);
  return c.json({
    data: {
      version: row.version,
      status: row.status,
      rendered: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        missing: rendered.missing,
      },
      problems: validateForPublish(content, declared, clean),
    },
  });
});

/**
 * Publish a version. Published versions are immutable from here on, and this is
 * the only thing that makes a template sendable.
 */
templates.post("/:id/versions/:version/publish", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const { getDb, templateVersions } = await import("@calder/db");
  const { and, eq } = await import("drizzle-orm");
  const db = getDb();
  const row = await loadVersion(db, c.req.param("id"), a.projectId, c.req.param("version"));
  if (!row) throw new AppError("not_found", "Template version not found", 404);

  const { extractVariables, normaliseVariables, validateForPublish } =
    await import("@calder/email");
  const body = (await c.req.json().catch(() => null)) ?? {};
  const previewInput = (body as { preview?: unknown }).preview;
  const preview =
    previewInput && typeof previewInput === "object"
      ? Object.fromEntries(
          Object.entries(previewInput as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined;

  const declared = normaliseVariables(row.variables);
  const problems = validateForPublish(
    { subject: row.subject, html: row.html, text: row.text },
    // A version saved before declarations existed has none; treat its own
    // placeholders as declared rather than blocking a publish forever.
    declared.length > 0
      ? declared
      : normaliseVariables(extractVariables(row.subject, row.html, row.text)),
    preview
  );
  if (problems.length > 0) {
    throw new AppError(
      "validation_error",
      `This version cannot be published: ${problems.map((p) => p.message).join(" ")}`,
      400,
      { problems },
      "Fix the problems, then publish again."
    );
  }

  const publishedAt = row.publishedAt ?? new Date();
  if (row.status !== "published") {
    // The version row is the unit: one id, one status flip.
    await db
      .update(templateVersions)
      .set({ status: "published", publishedAt })
      .where(eq(templateVersions.id, row.id));
  }
  return c.json({
    data: {
      version: row.version,
      status: "published",
      published_at: publishedAt,
      // Publishing twice is a no-op, not an error: retries and double clicks
      // are normal, and an error there would make callers handle a non-event.
      idempotent: row.status === "published",
    },
  });
});

export default templates;
