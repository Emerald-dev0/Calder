import { Hono } from "hono";
import { and, desc, eq, inArray, count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Env } from "../app.js";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { createCampaignSchema, createContactSchema, createListSchema, addListMemberSchema } from "@calder/validation";

const marketing = new Hono<Env>();
const getAuth = (c: { get: (key: string) => unknown }) => c.get("auth" as never) as AuthContext;
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

marketing.get("/contacts", authMiddleware, async (c) => {
  const a = getAuth(c); const { getDb, marketingContacts } = await import("@calder/db");
  const { limit = 50 } = { limit: Math.min(Number(c.req.query("limit") ?? 50) || 50, 200) };
  const rows = await getDb().select().from(marketingContacts).where(eq(marketingContacts.projectId, a.projectId)).orderBy(desc(marketingContacts.createdAt)).limit(limit);
  return c.json({ data: rows });
});

marketing.post("/contacts", authMiddleware, async (c) => {
  const a = getAuth(c); requireScope(a, "manage");
  const parsed = createContactSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError("Invalid marketing contact", parsed.error.flatten());
  const { getDb, marketingContacts } = await import("@calder/db");
  const now = new Date();
  const contact = { id: id("ct"), projectId: a.projectId, email: parsed.data.email, firstName: parsed.data.first_name, lastName: parsed.data.last_name, consentStatus: parsed.data.consent_status, consentSource: parsed.data.consent_source, consentedAt: parsed.data.consent_status === "subscribed" ? now : null, unsubscribedAt: parsed.data.consent_status === "unsubscribed" ? now : null, attributes: parsed.data.attributes ?? {}, updatedAt: now };
  const [row] = await getDb().insert(marketingContacts).values(contact).onConflictDoUpdate({ target: [marketingContacts.projectId, marketingContacts.email], set: { firstName: contact.firstName, lastName: contact.lastName, consentStatus: contact.consentStatus, consentSource: contact.consentSource, consentedAt: contact.consentedAt, unsubscribedAt: contact.unsubscribedAt, attributes: contact.attributes, updatedAt: now } }).returning();
  return c.json({ data: row }, 201);
});

marketing.delete("/contacts/:id", authMiddleware, async (c) => {
  const a = getAuth(c); requireScope(a, "manage"); const { getDb, marketingContacts } = await import("@calder/db");
  const rows = await getDb().delete(marketingContacts).where(and(eq(marketingContacts.id, c.req.param("id")), eq(marketingContacts.projectId, a.projectId))).returning({ id: marketingContacts.id });
  if (!rows.length) throw new AppError("not_found", "Contact not found", 404); return c.json({ data: { id: rows[0]!.id, deleted: true } });
});

marketing.get("/lists", authMiddleware, async (c) => {
  const a = getAuth(c); const { getDb, marketingLists, marketingListMembers } = await import("@calder/db");
  const rows = await getDb().select({ id: marketingLists.id, name: marketingLists.name, description: marketingLists.description, created_at: marketingLists.createdAt, members: count(marketingListMembers.contactId) }).from(marketingLists).leftJoin(marketingListMembers, eq(marketingListMembers.listId, marketingLists.id)).where(eq(marketingLists.projectId, a.projectId)).groupBy(marketingLists.id).orderBy(desc(marketingLists.createdAt));
  return c.json({ data: rows });
});

marketing.post("/lists", authMiddleware, async (c) => {
  const a = getAuth(c); requireScope(a, "manage"); const parsed = createListSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError("Invalid marketing list", parsed.error.flatten());
  const { getDb, marketingLists } = await import("@calder/db"); const [row] = await getDb().insert(marketingLists).values({ id: id("list"), projectId: a.projectId, name: parsed.data.name, description: parsed.data.description }).returning();
  return c.json({ data: row }, 201);
});

marketing.post("/lists/:listId/members", authMiddleware, async (c) => {
  const a = getAuth(c); requireScope(a, "manage"); const parsed = addListMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError("Invalid list member", parsed.error.flatten());
  const { getDb, marketingLists, marketingContacts, marketingListMembers } = await import("@calder/db"); const db = getDb();
  const [list] = await db.select({ id: marketingLists.id }).from(marketingLists).where(and(eq(marketingLists.id, c.req.param("listId")), eq(marketingLists.projectId, a.projectId))).limit(1);
  const [contact] = await db.select({ id: marketingContacts.id }).from(marketingContacts).where(and(eq(marketingContacts.id, parsed.data.contact_id), eq(marketingContacts.projectId, a.projectId))).limit(1);
  if (!list || !contact) throw new AppError("not_found", "List or contact not found", 404);
  await db.insert(marketingListMembers).values({ listId: list.id, contactId: contact.id }).onConflictDoNothing();
  return c.json({ data: { list_id: list.id, contact_id: contact.id } }, 201);
});

marketing.get("/campaigns", authMiddleware, async (c) => { const a = getAuth(c); const { getDb, marketingCampaigns } = await import("@calder/db"); return c.json({ data: await getDb().select().from(marketingCampaigns).where(eq(marketingCampaigns.projectId, a.projectId)).orderBy(desc(marketingCampaigns.createdAt)) }); });

marketing.post("/campaigns", authMiddleware, async (c) => {
  const a = getAuth(c); requireScope(a, "manage"); const parsed = createCampaignSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw validationError("Invalid marketing campaign", parsed.error.flatten());
  const { getDb, marketingCampaigns, marketingLists } = await import("@calder/db"); const db = getDb();
  const lists = await db.select({ id: marketingLists.id }).from(marketingLists).where(and(eq(marketingLists.projectId, a.projectId), inArray(marketingLists.id, parsed.data.list_ids)));
  if (lists.length !== parsed.data.list_ids.length) throw new AppError("not_found", "One or more lists do not belong to this project", 404);
  const [row] = await db.insert(marketingCampaigns).values({ id: id("cmp"), projectId: a.projectId, name: parsed.data.name, from: parsed.data.from, subject: parsed.data.subject, html: parsed.data.html, text: parsed.data.text, listIds: parsed.data.list_ids, scheduledAt: parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : null, status: parsed.data.scheduled_at ? "scheduled" : "draft" }).returning();
  return c.json({ data: row }, 201);
});

marketing.post("/campaigns/:id/send", authMiddleware, async (c) => {
  const a = getAuth(c); requireScope(a, "send");
  const { getDb, marketingCampaigns, marketingContacts, marketingListMembers } = await import("@calder/db");
  const db = getDb();
  const [campaign] = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, c.req.param("id")), eq(marketingCampaigns.projectId, a.projectId))).limit(1);
  if (!campaign) throw new AppError("not_found", "Campaign not found", 404);
  if (campaign.status === "sending" || campaign.status === "sent") throw new AppError("conflict", "Campaign has already been dispatched", 409);
  const listIds = campaign.listIds;
  const contacts = await db.selectDistinct({ email: marketingContacts.email }).from(marketingListMembers).innerJoin(marketingContacts, eq(marketingContacts.id, marketingListMembers.contactId)).where(and(inArray(marketingListMembers.listId, listIds), eq(marketingContacts.projectId, a.projectId), eq(marketingContacts.consentStatus, "subscribed")));
  const { handleSendEmail } = await import("../services/email-service.js");
  await db.update(marketingCampaigns).set({ status: "sending", recipientCount: contacts.length, updatedAt: new Date() }).where(eq(marketingCampaigns.id, campaign.id));
  let accepted = 0;
  for (const contact of contacts) {
    try {
      await handleSendEmail({ projectId: a.projectId, organizationId: a.organizationId, apiKeyId: a.apiKeyId, env: a.env, requestId: c.get("requestId"), idempotencyKey: `campaign:${campaign.id}:${contact.email}`, input: { from: campaign.from, to: contact.email, subject: campaign.subject, html: campaign.html ?? undefined, text: campaign.text ?? undefined, stream: "marketing" } });
      accepted++;
    } catch { /* individual suppressions/provider failures are reflected by their email records */ }
  }
  await db.update(marketingCampaigns).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(marketingCampaigns.id, campaign.id));
  return c.json({ data: { campaign_id: campaign.id, accepted, skipped: contacts.length - accepted, recipients: contacts.length } });
});

export default marketing;
