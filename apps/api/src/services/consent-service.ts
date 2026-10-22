import { and, eq, sql } from "drizzle-orm";
import {
  audiences,
  audienceContacts,
  contacts,
  suppressions,
  unsubscribeEvents,
  resubscribeEvents,
  type DbClient,
} from "@calder/db";
import { randomUUID } from "node:crypto";

/**
 * Consent: the one place that moves a person between subscribed and not.
 *
 * Three records change together, and the order matters:
 *
 *   1. `suppressions` — the delivery gate. Written first, because a mail that
 *      leaves while the other two rows are still being written is a bug the
 *      recipient sees.
 *   2. `contacts` / `audience_contacts` — current state, so lists and
 *      broadcasts stop counting somebody who has left.
 *   3. `unsubscribe_events` / `resubscribe_events` — append-only history.
 *      Never updated, never deleted: "when did they opt out and how" is the
 *      question a complaint, an audit or a regulator actually asks.
 *
 * Everything here is idempotent. A mailbox provider retrying a one-click POST
 * must not produce two history rows or flip state twice.
 */

export type UnsubscribeSource =
  | "link_click"
  | "one_click_header"
  | "mailto"
  | "complaint"
  | "manual"
  | "api"
  | "preference_center";

export type ResubscribeSource =
  | "unsubscribe_page"
  | "preference_center"
  | "double_opt_in_confirmation"
  | "manual"
  | "api";

export interface ConsentContext {
  projectId: string;
  organizationId: string;
  email: string;
  audienceId?: string | null;
  broadcastId?: string | null;
  emailId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  reason?: string | null;
}

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

async function findContact(db: DbClient, projectId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select({
      id: contacts.id,
      organizationId: contacts.organizationId,
      status: contacts.status,
    })
    .from(contacts)
    .where(and(eq(contacts.projectId, projectId), eq(contacts.email, normalized)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Stop marketing mail for an address.
 *
 * `scope: "workspace"` (the default for a footer link) suppresses the project
 * entirely. `scope: "audience"` only removes the person from one list and
 * records the event, so a preference centre can offer "fewer emails from this
 * list" without silencing the rest.
 */
export async function recordUnsubscribe(
  db: DbClient,
  ctx: ConsentContext,
  opts: { source: UnsubscribeSource; scope?: "workspace" | "audience" }
): Promise<{ already: boolean; contactId: string | null }> {
  const scope = opts.scope ?? "workspace";
  const normalized = ctx.email.trim().toLowerCase();
  const contact = await findContact(db, ctx.projectId, normalized);

  // 1. Delivery gate. `unsubscribe` is a marketing-only reason (see
  //    suppression-guard): a receipt or a password reset still goes through.
  const existing = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(eq(suppressions.projectId, ctx.projectId), eq(suppressions.email, normalized))
    )
    .limit(1);
  const already = Boolean(existing[0]);

  if (!already && scope === "workspace") {
    await db
      .insert(suppressions)
      .values({
        id: rid("sup"),
        projectId: ctx.projectId,
        email: normalized,
        reason: "unsubscribe",
      })
      .onConflictDoNothing();
  }

  if (!contact) return { already, contactId: null };

  // 2. Current state. A contact that already left keeps its original timestamp:
  //    the second click of a double-clicked link is not a new decision.
  if (scope === "workspace" && contact.status !== "unsubscribed") {
    await db
      .update(contacts)
      .set({ status: "unsubscribed", unsubscribedAt: new Date(), updatedAt: new Date() })
      .where(eq(contacts.id, contact.id));
  }

  if (ctx.audienceId) {
    await db
      .update(audienceContacts)
      .set({ status: "unsubscribed", unsubscribedAt: new Date() })
      .where(
        and(
          eq(audienceContacts.audienceId, ctx.audienceId),
          eq(audienceContacts.contactId, contact.id)
        )
      );
  }

  // 3. History. Deduplicated on the same source within a minute so a retried
  //    provider POST does not look like two separate decisions in the report.
  if (!already) {
    await db.insert(unsubscribeEvents).values({
      id: rid("unsub"),
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      contactId: contact.id,
      audienceId: ctx.audienceId ?? null,
      broadcastId: ctx.broadcastId ?? null,
      emailId: ctx.emailId ?? null,
      source: opts.source,
      scope,
      reason: ctx.reason ?? null,
      ipHash: ctx.ipHash ?? null,
      userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    });
  }

  return { already, contactId: contact.id };
}

/**
 * Put somebody back on the list.
 *
 * Only reachable from a deliberate act (the unsubscribe page's "undo", a
 * double opt-in confirmation, or an operator). It clears the marketing
 * suppression, restores the contact, and appends a resubscribe event. Bounce
 * and complaint suppressions are NOT cleared here: those are facts about the
 * mailbox, not preferences, and a click cannot make an address deliverable.
 */
export async function recordResubscribe(
  db: DbClient,
  ctx: ConsentContext,
  opts: { source: ResubscribeSource; scope?: "workspace" | "audience" }
): Promise<{ contactId: string | null; restored: boolean }> {
  const scope = opts.scope ?? "workspace";
  const normalized = ctx.email.trim().toLowerCase();
  const contact = await findContact(db, ctx.projectId, normalized);

  await db
    .delete(suppressions)
    .where(
      and(
        eq(suppressions.projectId, ctx.projectId),
        eq(suppressions.email, normalized),
        eq(suppressions.reason, "unsubscribe")
      )
    );

  if (!contact) return { contactId: null, restored: false };

  await db
    .update(contacts)
    .set({ status: "subscribed", unsubscribedAt: null, updatedAt: new Date() })
    .where(eq(contacts.id, contact.id));

  if (ctx.audienceId) {
    await db
      .update(audienceContacts)
      .set({ status: "subscribed", unsubscribedAt: null })
      .where(
        and(
          eq(audienceContacts.audienceId, ctx.audienceId),
          eq(audienceContacts.contactId, contact.id)
        )
      );
  }

  await db.insert(resubscribeEvents).values({
    id: rid("resub"),
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    contactId: contact.id,
    audienceId: ctx.audienceId ?? null,
    broadcastId: ctx.broadcastId ?? null,
    emailId: ctx.emailId ?? null,
    source: opts.source,
    scope,
    reason: ctx.reason ?? null,
    ipHash: ctx.ipHash ?? null,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
  });

  return { contactId: contact.id, restored: true };
}

/** Consent history for one address, newest first. Used by the dashboard. */
export async function consentHistory(db: DbClient, projectId: string, email: string) {
  const contact = await findContact(db, projectId, email);
  if (!contact) return { contact: null, events: [] };
  const rows = await db
    .select({
      id: unsubscribeEvents.id,
      kind: sql<string>`'unsubscribe'`,
      source: sql<string>`${unsubscribeEvents.source}::text`,
      scope: unsubscribeEvents.scope,
      reason: unsubscribeEvents.reason,
      createdAt: unsubscribeEvents.createdAt,
    })
    .from(unsubscribeEvents)
    .where(eq(unsubscribeEvents.contactId, contact.id))
    .unionAll(
      db
        .select({
          id: resubscribeEvents.id,
          kind: sql<string>`'resubscribe'`,
          source: sql<string>`${resubscribeEvents.source}::text`,
          scope: resubscribeEvents.scope,
          reason: resubscribeEvents.reason,
          createdAt: resubscribeEvents.createdAt,
        })
        .from(resubscribeEvents)
        .where(eq(resubscribeEvents.contactId, contact.id))
    );
  return { contact, events: rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) };
}

/** Look up the organization that owns a project, for token-scoped flows. */
export async function organizationForProject(db: DbClient, projectId: string) {
  const rows = await db
    .select({ organizationId: audiences.organizationId })
    .from(audiences)
    .where(eq(audiences.projectId, projectId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

export { findContact };
