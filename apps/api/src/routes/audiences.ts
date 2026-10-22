import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { audienceContacts, contacts, getDb } from "@calder/db";
import type { Env } from "../app.js";
import { AppError, validationError } from "../errors/index.js";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import {
  addContacts,
  archiveAudience,
  createAudience,
  getAudience,
  importCsv,
  listAudienceContacts,
  listAudiences,
  searchAudienceContacts,
  audienceStats,
  type ContactInput,
} from "@calder/audiences";

const audiencesRoute = new Hono<Env>();

function auth(c: { get: (key: never) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

function requireManage(c: { get: (key: never) => unknown }): AuthContext {
  const a = auth(c);
  requireScope(a, "manage");
  return a;
}

async function requireAudience(projectId: string, id: string) {
  const row = await getAudience(getDb(), projectId, id);
  if (!row) throw new AppError("not_found", "Audience not found", 404);
  return row;
}

function parseContacts(body: unknown): ContactInput[] {
  if (!Array.isArray(body)) throw validationError("`contacts` must be an array.");
  if (body.length > 5000) throw validationError("At most 5000 contacts per request.");
  return body.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw validationError(`contacts[${index}] must be an object with an email.`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.email !== "string" || item.email.trim() === "") {
      throw validationError(`contacts[${index}].email is required.`);
    }
    return {
      email: item.email,
      firstName: typeof item.firstName === "string" ? item.firstName.slice(0, 255) : null,
      lastName: typeof item.lastName === "string" ? item.lastName.slice(0, 255) : null,
      properties:
        typeof item.properties === "object" && item.properties !== null
          ? (item.properties as Record<string, unknown>)
          : {},
    };
  });
}

audiencesRoute.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  const data = await listAudiences(getDb(), a.projectId);
  return c.json({ data });
});

audiencesRoute.post("/", authMiddleware, async (c) => {
  const a = requireManage(c);
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const { name, description, doubleOptIn } = body as Record<string, unknown>;
  if (typeof name !== "string") throw validationError("`name` is required.");

  const row = await createAudience(getDb(), {
    organizationId: a.organizationId,
    projectId: a.projectId,
    name,
    description: typeof description === "string" ? description : null,
    doubleOptIn: Boolean(doubleOptIn),
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "Could not create audience.";
    // The unique index is on (project, name) where not archived.
    if (message.includes("audiences_project_name_unique")) {
      throw new AppError("conflict", "An audience with that name already exists.", 409);
    }
    throw new AppError("validation_error", message, 400);
  });

  return c.json({ data: row }, 201);
});

audiencesRoute.get("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  const row = await requireAudience(a.projectId, c.req.param("id"));
  const stats = await audienceStats(getDb(), row.id);
  return c.json({ data: { ...row, stats } });
});

audiencesRoute.post("/:id/archive", authMiddleware, async (c) => {
  const a = requireManage(c);
  const id = c.req.param("id");
  await requireAudience(a.projectId, id);
  const archived = await archiveAudience(getDb(), a.projectId, id);
  if (!archived) throw new AppError("conflict", "Audience is already archived.", 409);
  return c.json({ data: { id, archived: true } });
});

audiencesRoute.get("/:id/contacts", authMiddleware, async (c) => {
  const a = auth(c);
  const id = c.req.param("id");
  await requireAudience(a.projectId, id);
  const q = c.req.query("q");
  const status = c.req.query("status");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10) || 50;

  // Search is a separate path: a broadcast never uses it, a human looking for
  // one address does, and ILIKE inside a cursor-paginated query fights the index.
  if (q && q.trim().length > 0) {
    const found = await searchAudienceContacts(getDb(), id, q.trim(), limit);
    return c.json({ data: found, pagination: { has_more: false } });
  }

  const { data, hasMore } = await listAudienceContacts(getDb(), id, {
    limit,
    status:
      status === "subscribed" || status === "unsubscribed" || status === "pending_confirmation"
        ? status
        : undefined,
  });
  return c.json({ data, pagination: { has_more: hasMore } });
});

audiencesRoute.post("/:id/contacts", authMiddleware, async (c) => {
  const a = requireManage(c);
  const id = c.req.param("id");
  await requireAudience(a.projectId, id);
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = body as Record<string, unknown>;
  if (parsed.consentConfirmed !== true) {
    throw validationError(
      "Set consentConfirmed: true to confirm these contacts gave you permission to email them."
    );
  }
  const list = parseContacts(parsed.contacts);
  const counts = await addContacts(getDb(), {
    organizationId: a.organizationId,
    projectId: a.projectId,
    audienceId: id,
    contacts: list,
    consentSource: "api",
    consentNote: typeof parsed.consentNote === "string" ? parsed.consentNote : null,
  });
  return c.json({ data: counts }, 201);
});

audiencesRoute.post("/:id/import", authMiddleware, async (c) => {
  const a = requireManage(c);
  const id = c.req.param("id");
  await requireAudience(a.projectId, id);
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = body as Record<string, unknown>;
  if (typeof parsed.csv !== "string" || parsed.csv.trim() === "") {
    throw validationError("`csv` is required.");
  }
  if (parsed.consentConfirmed !== true) {
    throw validationError(
      "Set consentConfirmed: true to confirm these contacts gave you permission to email them."
    );
  }
  const result = await importCsv(getDb(), {
    organizationId: a.organizationId,
    projectId: a.projectId,
    audienceId: id,
    csv: parsed.csv,
    fileName: typeof parsed.fileName === "string" ? parsed.fileName : null,
    consentConfirmed: true,
  });
  return c.json({ data: result }, 201);
});

audiencesRoute.delete("/:id/contacts/:contactId", authMiddleware, async (c) => {
  const a = requireManage(c);
  const id = c.req.param("id");
  await requireAudience(a.projectId, id);
  const contactId = c.req.param("contactId");
  const db = getDb();

  // Removing membership is not deleting the person: the contact row keeps its
  // consent history, and this only stops future sends to this list.
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.projectId, a.projectId)))
    .limit(1);
  if (!contact) throw new AppError("not_found", "Contact not found", 404);

  const [removed] = await db
    .delete(audienceContacts)
    .where(
      and(eq(audienceContacts.audienceId, id), eq(audienceContacts.contactId, contactId))
    )
    .returning({ contactId: audienceContacts.contactId });
  if (!removed) throw new AppError("not_found", "Contact is not in this audience", 404);
  return c.json({ data: { removed: true } });
});

export default audiencesRoute;
