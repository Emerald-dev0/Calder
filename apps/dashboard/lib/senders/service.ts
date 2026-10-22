import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  apiKeySenders,
  activeApiKeysForProject,
  assertCanCreateResource,
  auditLogs,
  domains,
  emails,
  emailEvents,
  getDb,
  organizationForProject,
  projectTransports,
  senderIdentities,
  type DbClient,
} from "@calder/db";
import { createQueue } from "@calder/queue";
import { canManageProject } from "@calder/auth";
import { assertDashboardAdmissionAllowed } from "../sending-eligibility";

/**
 * Sender identities: every read and every mutation.
 *
 * The dashboard's server actions are thin wrappers around these functions, and
 * the integration suite calls them directly, so the tenant boundary is enforced
 * *here* rather than in whatever component happens to render the button. Each
 * function takes an explicit `SenderActor` instead of reading cookies, which is
 * what makes a cross-tenant test possible without a browser.
 *
 * Rules encoded below:
 *  - a sender is only visible to an actor whose projects include its project;
 *  - mutating also requires the caller to manage that project (owner/admin);
 *  - a project may hold at most one transactional default and one marketing
 *    default, and only a verified, non-archived sender may be a default;
 *  - archiving replaces deletion whenever the sender has delivery history,
 *    because deleting would break the "which address sent this?" question;
 *  - archived senders never appear in a picker and never consume a plan slot.
 */

export interface SenderActor {
  userId: string;
  /** Every project the actor may read. */
  projectIds: string[];
}

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Statuses that may actually send. Everything else explains itself in the UI. */
export const USABLE_STATUSES = ["verified", "connected"] as const;
export function isUsableStatus(status: string): boolean {
  return (USABLE_STATUSES as readonly string[]).includes(status);
}

export class SenderNotFoundError extends Error {
  readonly code = "not_found";
  constructor() {
    super("Sender not found.");
    this.name = "SenderNotFoundError";
  }
}

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function assertProjectVisible(actor: SenderActor, projectId: string): void {
  if (!actor.projectIds.includes(projectId)) throw new SenderNotFoundError();
}

function assertProjectInActor(actor: SenderActor, projectId: string | null | undefined): string {
  if (!projectId || !actor.projectIds.includes(projectId)) throw new SenderNotFoundError();
  return projectId;
}

async function loadSender(db: DbClient, actor: SenderActor, senderId: string) {
  const [row] = await db
    .select()
    .from(senderIdentities)
    .where(
      and(
        eq(senderIdentities.id, senderId),
        inArray(senderIdentities.projectId, actor.projectIds.length > 0 ? actor.projectIds : [""])
      )
    )
    .limit(1);
  if (!row) throw new SenderNotFoundError();
  return row;
}

async function requireManage(actor: SenderActor, projectId: string): Promise<void> {
  const ok = await canManageProject(actor.userId, projectId);
  if (!ok) throw new Error("Only organization owners or admins can manage senders.");
}

async function audit(
  db: DbClient,
  input: {
    projectId: string;
    actorUserId: string;
    action: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const organizationId = await organizationForProject(db, input.projectId);
    await db.insert(auditLogs).values({
      id: rid("audit"),
      organizationId: organizationId ?? null,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: "sender",
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    });
  } catch {
    // Auditing must never roll back the operation it describes.
  }
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export interface SenderRow {
  id: string;
  projectId: string;
  displayName: string;
  email: string;
  type: string;
  status: string;
  statusReason: string | null;
  isDefault: boolean;
  isDefaultMarketing: boolean;
  replyTo: string | null;
  archivedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export async function listSenders(
  actor: SenderActor,
  projectId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<SenderRow[]> {
  assertProjectVisible(actor, projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: senderIdentities.id,
      projectId: senderIdentities.projectId,
      displayName: senderIdentities.displayName,
      email: senderIdentities.email,
      type: senderIdentities.type,
      status: senderIdentities.status,
      statusReason: senderIdentities.statusReason,
      isDefault: senderIdentities.isDefault,
      isDefaultMarketing: senderIdentities.isDefaultMarketing,
      replyTo: senderIdentities.replyTo,
      archivedAt: senderIdentities.archivedAt,
      lastUsedAt: senderIdentities.lastUsedAt,
      createdAt: senderIdentities.createdAt,
    })
    .from(senderIdentities)
    .where(
      and(
        eq(senderIdentities.projectId, projectId),
        opts.includeArchived ? undefined : isNull(senderIdentities.archivedAt)
      )
    )
    .orderBy(desc(senderIdentities.isDefault), desc(senderIdentities.createdAt));
  return rows;
}

export async function getSender(actor: SenderActor, senderId: string): Promise<SenderRow> {
  const row = await loadSender(getDb(), actor, senderId);
  return {
    id: row.id,
    projectId: row.projectId,
    displayName: row.displayName,
    email: row.email,
    type: row.type,
    status: row.status,
    statusReason: row.statusReason,
    isDefault: row.isDefault,
    isDefaultMarketing: row.isDefaultMarketing,
    replyTo: row.replyTo,
    archivedAt: row.archivedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export interface SenderHealth {
  sent7d: number;
  bounced7d: number;
  /** Bounces ÷ sends over the window; null when nothing was sent. */
  bounceRate: number | null;
  /** True above the 5% deliverability threshold. */
  warned: boolean;
}

export const BOUNCE_WARN_RATE = 0.05;

/**
 * Seven-day deliverability per sender, from real events.
 *
 * The denominator is every message the sender produced in the window; the
 * numerator is messages with a *bounced event*, counted once each (a provider
 * can report the same bounce twice, and a retried delivery is still one send).
 */
export async function senderHealth(projectId: string): Promise<Map<string, SenderHealth>> {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [sentRows, bounceRows] = await Promise.all([
    db
      .select({ senderId: emails.senderIdentityId, value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, projectId), gte(emails.createdAt, since)))
      .groupBy(emails.senderIdentityId),
    db
      .select({ senderId: emails.senderIdentityId, value: sql<number>`count(distinct ${emails.id})::int` })
      .from(emails)
      .innerJoin(emailEvents, eq(emailEvents.emailId, emails.id))
      .where(
        and(
          eq(emails.projectId, projectId),
          eq(emailEvents.type, "bounced"),
          gte(emailEvents.createdAt, since)
        )
      )
      .groupBy(emails.senderIdentityId),
  ]);

  const bounced = new Map<string, number>();
  for (const row of bounceRows) {
    if (row.senderId) bounced.set(row.senderId, Number(row.value));
  }

  const health = new Map<string, SenderHealth>();
  for (const row of sentRows) {
    if (!row.senderId) continue;
    const sent = Number(row.value);
    const bad = bounced.get(row.senderId) ?? 0;
    const rate = sent === 0 ? null : bad / sent;
    health.set(row.senderId, {
      sent7d: sent,
      bounced7d: bad,
      bounceRate: rate,
      warned: rate !== null && rate > BOUNCE_WARN_RATE,
    });
  }
  return health;
}

export interface StreamStats {
  transactional: { sent: number; delivered: number; bounced: number; complained: number };
  marketing: { sent: number; delivered: number; bounced: number; complained: number };
}

const emptyStream = () => ({ sent: 0, delivered: 0, bounced: 0, complained: 0 });

/**
 * Seven-day totals per stream, so the stat cards can be segmented without
 * inventing a number: every figure is a count of real rows in the window.
 */
export async function streamStats(projectId: string): Promise<StreamStats> {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ stream: emails.stream, status: emails.status, value: count() })
    .from(emails)
    .where(and(eq(emails.projectId, projectId), gte(emails.createdAt, since)))
    .groupBy(emails.stream, emails.status);

  const out: StreamStats = { transactional: emptyStream(), marketing: emptyStream() };
  for (const row of rows) {
    const bucket = row.stream === "marketing" ? out.marketing : out.transactional;
    const n = Number(row.value);
    bucket.sent += n;
    if (row.status === "delivered") bucket.delivered += n;
    if (row.status === "bounced") bucket.bounced += n;
    if (row.status === "complained") bucket.complained += n;
  }
  return out;
}

/**
 * Seven-day totals per stream for one sender. Same measurement as the project
 * cards, narrowed to a single identity, so the detail page cannot disagree
 * with the list it came from.
 */
export async function senderStreamStats(
  actor: SenderActor,
  senderId: string
): Promise<StreamStats> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ stream: emails.stream, status: emails.status, value: count() })
    .from(emails)
    .where(
      and(
        eq(emails.projectId, sender.projectId),
        eq(emails.senderIdentityId, sender.id),
        gte(emails.createdAt, since)
      )
    )
    .groupBy(emails.stream, emails.status);

  const out: StreamStats = { transactional: emptyStream(), marketing: emptyStream() };
  for (const row of rows) {
    const bucket = row.stream === "marketing" ? out.marketing : out.transactional;
    const n = Number(row.value);
    bucket.sent += n;
    if (row.status === "delivered") bucket.delivered += n;
    if (row.status === "bounced") bucket.bounced += n;
    if (row.status === "complained") bucket.complained += n;
  }
  return out;
}

/** Seven-day health for one sender (the map narrowed to a single id). */
export async function senderHealthFor(
  actor: SenderActor,
  senderId: string
): Promise<SenderHealth> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  const map = await senderHealth(sender.projectId);
  return map.get(sender.id) ?? { sent7d: 0, bounced7d: 0, bounceRate: null, warned: false };
}

/* ── Creation ─────────────────────────────────────────────────────────────── */

export interface CreateSenderResult {
  id: string;
}

/**
 * Create a sender on a verified domain.
 *
 * The plan ceiling is checked before anything is written, and the count it uses
 * excludes archived senders — archiving a sender frees its slot.
 */
export async function createDomainSender(
  actor: SenderActor,
  input: { projectId: string; displayName: string; localPart: string; domain: string }
): Promise<CreateSenderResult> {
  assertProjectVisible(actor, input.projectId);
  await requireManage(actor, input.projectId);
  const db = getDb();

  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.projectId, input.projectId), eq(domains.domain, input.domain)))
    .limit(1);
  if (!domain || domain.status !== "verified") {
    throw new Error(`Verify ${input.domain} before creating senders on it.`);
  }

  const local = input.localPart.trim().toLowerCase();
  if (!LOCAL_PART_RE.test(local)) throw new Error("Local part: letters, numbers, . _ - (max 64).");
  const displayName = input.displayName.trim().slice(0, 255);
  if (displayName.length < 2) throw new Error("Give the sender a display name.");

  const organizationId = await organizationForProject(db, input.projectId);
  if (!organizationId) throw new SenderNotFoundError();
  await assertCanCreateResource(db, organizationId, "senders");

  const id = `sender_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  try {
    await db.insert(senderIdentities).values({
      id,
      projectId: input.projectId,
      displayName,
      email: `${local}@${input.domain}`,
      type: "domain",
      status: "verified",
    });
  } catch {
    throw new Error("That address is already a sender on this project.");
  }
  await audit(db, {
    projectId: input.projectId,
    actorUserId: actor.userId,
    action: "sender.created",
    targetId: id,
    metadata: { type: "domain", email: `${local}@${input.domain}` },
  });
  return { id };
}

/** Create a sender backed by an already-connected Gmail transport. */
export async function createGmailSender(
  actor: SenderActor,
  input: { projectId: string; transportId: string; displayName: string }
): Promise<CreateSenderResult> {
  assertProjectVisible(actor, input.projectId);
  await requireManage(actor, input.projectId);
  const db = getDb();

  const [transport] = await db
    .select()
    .from(projectTransports)
    .where(
      and(
        eq(projectTransports.id, input.transportId),
        eq(projectTransports.projectId, input.projectId)
      )
    )
    .limit(1);
  if (!transport || transport.type !== "gmail" || transport.status !== "active") {
    throw new Error("That Gmail connection is no longer active. Reconnect it first.");
  }

  const displayName = input.displayName.trim().slice(0, 255);
  if (displayName.length < 2) throw new Error("Give the sender a display name.");

  const organizationId = await organizationForProject(db, input.projectId);
  if (!organizationId) throw new SenderNotFoundError();
  await assertCanCreateResource(db, organizationId, "senders");

  const id = `sender_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  try {
    await db.insert(senderIdentities).values({
      id,
      projectId: input.projectId,
      displayName,
      email: transport.label,
      type: "gmail",
      transportId: transport.id,
      status: "connected",
    });
  } catch {
    throw new Error("That address is already a sender on this project.");
  }
  await audit(db, {
    projectId: input.projectId,
    actorUserId: actor.userId,
    action: "sender.created",
    targetId: id,
    metadata: { type: "gmail", email: transport.label },
  });
  return { id };
}

/* ── Defaults ─────────────────────────────────────────────────────────────── */

export type DefaultKind = "transactional" | "marketing";

/**
 * Set or clear one of the two project defaults.
 *
 * `is_default` (transactional) and `is_default_marketing` (broadcast) are
 * separate: an application can send OTPs from `no-reply@` and campaigns from
 * `hello@`. Each is unique per project — setting one clears the previous
 * holder in the same transaction — and only a verified, non-archived sender may
 * hold either.
 */
export async function setSenderDefault(
  actor: SenderActor,
  senderId: string,
  kind: DefaultKind,
  value: boolean
): Promise<{ ok: true }> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);

  if (sender.archivedAt) {
    throw new Error("An archived sender cannot be a default. Unarchive it first.");
  }
  if (value && !isUsableStatus(sender.status)) {
    throw new Error(
      `${sender.email} is ${sender.status}. Only a verified or connected sender can be a default.`
    );
  }

  const column = kind === "marketing" ? "isDefaultMarketing" : "isDefault";

  await db.transaction(async (tx) => {
    if (value) {
      // Clear the previous holder first: the marketing default has a partial
      // unique index, so two rows cannot both claim it even for a moment.
      await tx
        .update(senderIdentities)
        .set({ [column]: false, updatedAt: new Date() })
        .where(eq(senderIdentities.projectId, sender.projectId));
    }
    await tx
      .update(senderIdentities)
      .set({ [column]: value, updatedAt: new Date() })
      .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  });

  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: value ? "sender.default_set" : "sender.default_cleared",
    targetId: senderId,
    metadata: { kind },
  });
  return { ok: true };
}

/* ── Edits ────────────────────────────────────────────────────────────────── */

export async function updateSenderDisplayName(
  actor: SenderActor,
  senderId: string,
  displayName: string
): Promise<{ ok: true }> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);
  const clean = displayName.trim().slice(0, 255);
  if (clean.length < 2) throw new Error("Give the sender a display name.");
  if (sender.archivedAt) throw new Error("Unarchive this sender before editing it.");

  await db
    .update(senderIdentities)
    .set({ displayName: clean, updatedAt: new Date() })
    .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.updated",
    targetId: senderId,
    metadata: { field: "display_name", from: sender.displayName, to: clean },
  });
  return { ok: true };
}

/**
 * Reply-To for this identity. An empty string clears it, which means "reply to
 * the From address" — the long-standing behaviour for senders without one.
 */
export async function setSenderReplyTo(
  actor: SenderActor,
  senderId: string,
  replyTo: string | null
): Promise<{ ok: true; replyTo: string | null }> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);
  if (sender.archivedAt) throw new Error("Unarchive this sender before editing it.");

  const clean = (replyTo ?? "").trim().toLowerCase();
  if (clean && !EMAIL_RE.test(clean)) throw new Error("Enter a valid Reply-To address.");
  if (clean.length > 320) throw new Error("Reply-To is too long.");

  const value = clean || null;
  await db
    .update(senderIdentities)
    .set({ replyTo: value, updatedAt: new Date() })
    .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.updated",
    targetId: senderId,
    metadata: { field: "reply_to", to: value },
  });
  return { ok: true, replyTo: value };
}

/**
 * Disable or re-enable. Re-enabling re-verifies against ground truth (domain
 * still verified / transport still active) instead of assuming.
 */
export async function setSenderEnabled(
  actor: SenderActor,
  senderId: string,
  enabled: boolean
): Promise<{ ok: true }> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);
  if (sender.archivedAt) throw new Error("This sender is archived.");

  if (!enabled) {
    await db
      .update(senderIdentities)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
    await audit(db, {
      projectId: sender.projectId,
      actorUserId: actor.userId,
      action: "sender.disabled",
      targetId: senderId,
    });
    return { ok: true };
  }

  if (sender.type === "domain") {
    const domain = sender.email.split("@")[1] ?? "";
    const [row] = await db
      .select()
      .from(domains)
      .where(and(eq(domains.projectId, sender.projectId), eq(domains.domain, domain)))
      .limit(1);
    if (!row || row.status !== "verified") {
      throw new Error(`Re-verify ${domain} before re-enabling this sender.`);
    }
    await db
      .update(senderIdentities)
      .set({ status: "verified", updatedAt: new Date() })
      .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  } else {
    const [transport] = await db
      .select()
      .from(projectTransports)
      .where(
        and(
          eq(projectTransports.id, sender.transportId ?? ""),
          eq(projectTransports.projectId, sender.projectId)
        )
      )
      .limit(1);
    if (!transport || transport.status !== "active") {
      throw new Error("Reconnect the Gmail account before re-enabling this sender.");
    }
    await db
      .update(senderIdentities)
      .set({ status: "connected", updatedAt: new Date() })
      .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  }
  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.enabled",
    targetId: senderId,
  });
  return { ok: true };
}

/* ── Archiving ────────────────────────────────────────────────────────────── */

export interface RetireResult {
  /** "archived" keeps the row; "deleted" removes one with no history. */
  mode: "archived" | "deleted";
  emailCount: number;
}

/**
 * Retire a sender.
 *
 * Deleting a sender that has sent mail would orphan the question "which address
 * did this come from?", and the FK is `set null`, so the history would quietly
 * lose its attribution. A sender with any delivery history is therefore
 * archived: it disappears from every picker, frees its plan slot, keeps its
 * rows. A sender that never sent anything is genuinely deleted, because there
 * is nothing to preserve.
 */
export async function retireSender(actor: SenderActor, senderId: string): Promise<RetireResult> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);
  if (sender.archivedAt) return { mode: "archived", emailCount: 0 };

  const [row] = await db
    .select({ value: count() })
    .from(emails)
    .where(and(eq(emails.senderIdentityId, senderId), eq(emails.projectId, sender.projectId)));
  const emailCount = Number(row?.value ?? 0);

  if (emailCount > 0) {
    await db
      .update(senderIdentities)
      .set({
        archivedAt: new Date(),
        // A default that is archived must stop being the default, or the send
        // path would resolve an address that is no longer selectable.
        isDefault: false,
        isDefaultMarketing: false,
        updatedAt: new Date(),
      })
      .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
    await audit(db, {
      projectId: sender.projectId,
      actorUserId: actor.userId,
      action: "sender.archived",
      targetId: senderId,
      metadata: { emailCount },
    });
    return { mode: "archived", emailCount };
  }

  await db
    .delete(senderIdentities)
    .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.deleted",
    targetId: senderId,
    metadata: { emailCount: 0 },
  });
  return { mode: "deleted", emailCount: 0 };
}

/** Reverse an archive. The sender comes back disabled-adjacent: not a default. */
export async function unarchiveSender(actor: SenderActor, senderId: string): Promise<{ ok: true }> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);
  if (!sender.archivedAt) return { ok: true };
  await db
    .update(senderIdentities)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.unarchived",
    targetId: senderId,
  });
  return { ok: true };
}

/* ── Allowed API keys ─────────────────────────────────────────────────────── */

/**
 * Which keys may use this sender.
 *
 * The join table is the source of truth, and **no rows means unrestricted** —
 * which is what every existing key already is, so shipping this must not
 * silently lock anyone out. Enforcement at send time belongs to the API-keys
 * page; this builds the selector and the storage.
 */
export async function senderAllowedKeyIds(
  actor: SenderActor,
  senderId: string
): Promise<string[]> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  const rows = await db
    .select({ apiKeyId: apiKeySenders.apiKeyId })
    .from(apiKeySenders)
    .where(eq(apiKeySenders.senderId, sender.id));
  return rows.map((r) => r.apiKeyId);
}

export async function projectApiKeys(actor: SenderActor, projectId: string) {
  assertProjectVisible(actor, projectId);
  return activeApiKeysForProject(getDb(), projectId);
}

export async function setSenderAllowedKeys(
  actor: SenderActor,
  senderId: string,
  keyIds: string[]
): Promise<{ ok: true; restricted: boolean }> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);

  // Only keys from this sender's own project may be granted; anything else is
  // a cross-tenant reference and is rejected rather than silently dropped.
  const projectKeys = await activeApiKeysForProject(db, sender.projectId);
  const allowed = new Set(projectKeys.map((k) => k.id));
  const requested = [...new Set(keyIds)];
  const foreign = requested.filter((id) => !allowed.has(id));
  if (foreign.length > 0) {
    throw new Error("One of those API keys does not belong to this project.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(apiKeySenders).where(eq(apiKeySenders.senderId, senderId));
    if (requested.length > 0) {
      await tx.insert(apiKeySenders).values(
        requested.map((apiKeyId) => ({
          id: rid("aks"),
          apiKeyId,
          senderId,
        }))
      );
    }
  });

  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.api_keys_updated",
    targetId: senderId,
    metadata: { restricted: requested.length > 0, keyCount: requested.length },
  });
  return { ok: true, restricted: requested.length > 0 };
}

/* ── Test send ────────────────────────────────────────────────────────────── */

export interface DispatchResult {
  emailId: string;
  status: string;
}

/**
 * Dispatch one real message through this sender.
 *
 * It persists and enqueues exactly like a normal send (same admission gate,
 * same queue, same worker), so a success here means the whole path works. It
 * reports *acceptance*, never delivery — the UI polls `dispatchStatus` and only
 * claims what the provider actually reported.
 */
export async function dispatchTestEmail(
  actor: SenderActor,
  senderId: string,
  to: string
): Promise<DispatchResult> {
  const db = getDb();
  const sender = await loadSender(db, actor, senderId);
  await requireManage(actor, sender.projectId);
  if (sender.archivedAt) throw new Error("This sender is archived. Unarchive it to test it.");

  const address = to.trim().toLowerCase();
  if (!EMAIL_RE.test(address)) throw new Error("Enter a valid recipient address.");
  if (!isUsableStatus(sender.status)) {
    throw new Error(`${sender.email} isn't ready. Check its status first.`);
  }

  const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const { withProjectSendingEligibility } = await import("@calder/db");
  const admission = await withProjectSendingEligibility(
    db,
    { projectId: sender.projectId, env: "live" },
    async (tx) => {
      await tx.insert(emails).values({
        id: emailId,
        projectId: sender.projectId,
        from: sender.email,
        senderIdentityId: sender.id,
        fromName: sender.displayName,
        to: address,
        subject: `Test send from ${sender.displayName}`,
        text: `This is a test send from ${sender.displayName} <${sender.email}> via Calder. If you're reading this, the sender works end to end.`,
        status: "queued",
        env: "live",
      });
      await tx.insert(emailEvents).values({
        id: rid("ev"),
        emailId,
        projectId: sender.projectId,
        type: "queued",
        data: { via: "dashboard-test-send" },
      });
      return emailId;
    }
  );
  // Nothing was committed when admission refuses, so the caller can retry later.
  assertDashboardAdmissionAllowed(admission.decision);
  if (!admission.allowed) throw new Error("Sending is unavailable for this organization.");

  const queue = createQueue<{ emailId: string; projectId: string }>("email:send", { maxAttempts: 5 });
  await queue.enqueue("send-email", { emailId, projectId: sender.projectId });

  await db
    .update(senderIdentities)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(senderIdentities.id, senderId), eq(senderIdentities.projectId, sender.projectId)));
  await audit(db, {
    projectId: sender.projectId,
    actorUserId: actor.userId,
    action: "sender.test_send",
    targetId: senderId,
    metadata: { emailId },
  });
  return { emailId, status: "queued" };
}

export interface DispatchStatus {
  id: string;
  status: string;
  lastError: string | null;
  updatedAt: string;
  events: Array<{ type: string; at: string }>;
  terminal: boolean;
}

const TERMINAL = new Set(["delivered", "bounced", "complained", "failed"]);

/**
 * Current state of a dispatched test message, for the live row.
 *
 * Scoped to the sender's project, so an id from another workspace is simply
 * "not found" rather than readable.
 */
export async function dispatchStatus(
  actor: SenderActor,
  projectId: string,
  emailId: string
): Promise<DispatchStatus | null> {
  assertProjectInActor(actor, projectId);
  const db = getDb();
  const [row] = await db
    .select({
      id: emails.id,
      status: emails.status,
      lastError: emails.lastError,
      updatedAt: emails.updatedAt,
      stream: emails.stream,
    })
    .from(emails)
    .where(and(eq(emails.id, emailId), eq(emails.projectId, projectId)))
    .limit(1);
  if (!row) return null;

  const events = await db
    .select({ type: emailEvents.type, at: emailEvents.createdAt })
    .from(emailEvents)
    .where(and(eq(emailEvents.emailId, emailId), eq(emailEvents.projectId, projectId)))
    .orderBy(emailEvents.createdAt);

  return {
    id: row.id,
    status: row.status,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
    events: events.map((e) => ({ type: e.type, at: e.at.toISOString() })),
    terminal: TERMINAL.has(row.status),
  };
}

/* ── Provider readiness (for the "add sender" panel) ──────────────────────── */

export async function senderCreationOptions(actor: SenderActor, projectId: string) {
  assertProjectVisible(actor, projectId);
  const db = getDb();
  const [verifiedDomains, gmailTransports] = await Promise.all([
    db
      .select({ domain: domains.domain })
      .from(domains)
      .where(and(eq(domains.projectId, projectId), eq(domains.status, "verified"))),
    db
      .select({ id: projectTransports.id, label: projectTransports.label })
      .from(projectTransports)
      .where(
        and(
          eq(projectTransports.projectId, projectId),
          eq(projectTransports.type, "gmail"),
          eq(projectTransports.status, "active")
        )
      ),
  ]);
  return {
    verifiedDomains: verifiedDomains.map((d) => d.domain),
    gmailTransports,
  };
}
