"use server";

import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import {
  getDb,
  senderIdentities,
  projectTransports,
  domains,
  emails,
  emailEvents,
} from "@calder/db";
import { canManageProject } from "@calder/auth";
import { getTenantContext } from "../../../lib/auth";

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;

/** Membership check: throws unless the caller belongs to the sender's project. */
async function scopedSender(senderId: string) {
  const ctx = await getTenantContext();
  const db = getDb();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.id, senderId))
    .limit(1);
  if (!sender || !projectIds.has(sender.projectId)) throw new Error("Sender not found.");
  return { ctx, db, sender };
}

async function assertCanManage(userId: string, projectId: string): Promise<void> {
  const ok = await canManageProject(userId, projectId);
  if (!ok) throw new Error("Only organization owners or admins can manage senders.");
}

export interface SenderListItem {
  id: string;
  displayName: string;
  email: string;
  type: string;
  status: string;
  isDefault: boolean;
  lastUsedAt: Date | null;
}

/** List a project's sender identities. Read-only: membership implied by page context. */
export async function listSenders(projectId: string): Promise<SenderListItem[]> {
  const ctx = await getTenantContext();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!projectIds.has(projectId)) throw new Error("Project not found.");
  const db = getDb();
  return db
    .select({
      id: senderIdentities.id,
      displayName: senderIdentities.displayName,
      email: senderIdentities.email,
      type: senderIdentities.type,
      status: senderIdentities.status,
      isDefault: senderIdentities.isDefault,
      lastUsedAt: senderIdentities.lastUsedAt,
    })
    .from(senderIdentities)
    .where(eq(senderIdentities.projectId, projectId));
}

/**
 * Create a domain sender. The domain must already be verified for this
 * project; the backend enforces it, never the UI alone.
 */
export async function createDomainSender(input: {
  projectId: string;
  displayName: string;
  localPart: string;
  domain: string;
}): Promise<{ id: string }> {
  const ctx = await getTenantContext();
  await assertCanManage(ctx.user.userId, input.projectId);
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
  return { id };
}

/** Create a sender identity from an already-connected Gmail transport. */
export async function createGmailSender(input: {
  projectId: string;
  transportId: string;
  displayName: string;
}): Promise<{ id: string }> {
  const ctx = await getTenantContext();
  await assertCanManage(ctx.user.userId, input.projectId);
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
  return { id };
}

/** Set the project default. Explicit sends always win over the default. */
export async function setDefaultSender(senderId: string): Promise<{ ok: true }> {
  const { ctx, db, sender } = await scopedSender(senderId);
  await assertCanManage(ctx.user.userId, sender.projectId);
  await db
    .update(senderIdentities)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(senderIdentities.projectId, sender.projectId));
  await db
    .update(senderIdentities)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(senderIdentities.id, senderId));
  return { ok: true };
}

export async function updateSenderDisplayName(
  senderId: string,
  displayName: string
): Promise<{ ok: true }> {
  const { ctx, db, sender } = await scopedSender(senderId);
  await assertCanManage(ctx.user.userId, sender.projectId);
  const clean = displayName.trim().slice(0, 255);
  if (clean.length < 2) throw new Error("Give the sender a display name.");
  await db
    .update(senderIdentities)
    .set({ displayName: clean, updatedAt: new Date() })
    .where(eq(senderIdentities.id, senderId));
  return { ok: true };
}

/**
 * Disable or re-enable. Re-enabling re-verifies against ground truth
 * (domain still verified / transport still active) instead of assuming.
 */
export async function setSenderEnabled(senderId: string, enabled: boolean): Promise<{ ok: true }> {
  const { ctx, db, sender } = await scopedSender(senderId);
  await assertCanManage(ctx.user.userId, sender.projectId);
  if (!enabled) {
    await db
      .update(senderIdentities)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(senderIdentities.id, senderId));
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
      .where(eq(senderIdentities.id, senderId));
    return { ok: true };
  }
  const [transport] = await db
    .select()
    .from(projectTransports)
    .where(eq(projectTransports.id, sender.transportId ?? ""))
    .limit(1);
  if (!transport || transport.status !== "active") {
    throw new Error("Reconnect the Gmail account before re-enabling this sender.");
  }
  await db
    .update(senderIdentities)
    .set({ status: "connected", updatedAt: new Date() })
    .where(eq(senderIdentities.id, senderId));
  return { ok: true };
}

/**
 * Delete a sender. Deliveries keep their records (FK set null); the count
 * is returned so the UI states the consequence before confirming.
 */
export async function deleteSender(senderId: string): Promise<{ ok: true; emailCount: number }> {
  const { ctx, db, sender } = await scopedSender(senderId);
  await assertCanManage(ctx.user.userId, sender.projectId);
  const [row] = await db
    .select({ value: count() })
    .from(emails)
    .where(eq(emails.senderIdentityId, senderId));
  await db.delete(senderIdentities).where(eq(senderIdentities.id, senderId));
  return { ok: true, emailCount: row?.value ?? 0 };
}

/**
 * Test send through a sender: validates usability, persists the email, and
 * enqueues on the same contract the API uses, so the worker delivers it
 * identically. Reports acceptance only, never claims delivery.
 */
export async function testSend(
  senderId: string,
  to: string
): Promise<{ ok: true; emailId: string }> {
  const { db, sender } = await scopedSender(senderId);
  const address = to.trim().toLowerCase();
  if (!/^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{2,}$/.test(address)) {
    throw new Error("Enter a valid recipient address.");
  }
  const usable = sender.status === "verified" || sender.status === "connected";
  if (!usable) throw new Error(`${sender.email} isn't ready. Check its status first.`);
  const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(emails).values({
    id: emailId,
    projectId: sender.projectId,
    from: sender.email,
    senderIdentityId: sender.id,
    fromName: sender.displayName,
    to: address,
    subject: `Test send from ${sender.displayName}`,
    text: `This is a test send from ${sender.displayName} <${sender.email}> via Calder. If you're reading this, the sender works end to end.`,
    status: "queued",
    // Explicit: a human pressed "send test" in the dashboard.
    env: "live",
  });
  await db.insert(emailEvents).values({
    id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    emailId,
    projectId: sender.projectId,
    type: "queued",
    data: { via: "dashboard-test-send" },
  });
  const { createQueue } = await import("@calder/queue");
  const queue = createQueue<{ emailId: string; projectId: string }>("email:send", {
    maxAttempts: 5,
  });
  await queue.enqueue("send-email", { emailId, projectId: sender.projectId });
  await db
    .update(senderIdentities)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(senderIdentities.id, senderId));
  return { ok: true, emailId };
}
