"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import {
  getDb,
  audiences,
  audienceContacts,
  broadcastRecipients,
  broadcasts,
  senderIdentities,
} from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { cancelBroadcast, dispatchBroadcast, sendBroadcastTest } from "../../../lib/broadcasts/dispatch";

async function requireProject(projectId: string) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, projectId);
  if (!scope) throw new Error("Project not found.");
  return scope;
}

/** Audiences and verified senders a new broadcast may use. */
export async function broadcastOptions(projectId: string) {
  const scope = await requireProject(projectId);
  const db = getDb();

  const lists = await db
    .select({
      id: audiences.id,
      name: audiences.name,
      subscribed: count(audienceContacts.contactId),
    })
    .from(audiences)
    .leftJoin(
      audienceContacts,
      and(
        eq(audienceContacts.audienceId, audiences.id),
        eq(audienceContacts.status, "subscribed")
      )
    )
    .where(and(eq(audiences.projectId, scope.project.id), isNull(audiences.archivedAt)))
    .groupBy(audiences.id, audiences.name);

  const senders = await db
    .select({
      id: senderIdentities.id,
      email: senderIdentities.email,
      name: senderIdentities.displayName,
    })
    .from(senderIdentities)
    .where(
      and(
        eq(senderIdentities.projectId, scope.project.id),
        eq(senderIdentities.status, "verified"),
        isNull(senderIdentities.archivedAt)
      )
    );

  return {
    projectId: scope.project.id,
    audiences: lists.map((row) => ({ ...row, subscribed: Number(row.subscribed) })),
    senders,
  };
}

export async function createBroadcastAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const scope = await requireProject(projectId);
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const previewText = String(formData.get("previewText") ?? "").trim();
  const html = String(formData.get("html") ?? "").trim();
  const senderId = String(formData.get("senderId") ?? "");
  const audienceId = String(formData.get("audienceId") ?? "");

  if (!name || !subject || !html) throw new Error("Name, subject and body are required.");
  if (!senderId) throw new Error("Choose a verified sender.");
  if (!audienceId) throw new Error("Choose an audience.");

  const db = getDb();
  const [row] = await db
    .insert(broadcasts)
    .values({
      id: `bc_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: scope.organization.id,
      projectId: scope.project.id,
      name: name.slice(0, 255),
      status: "draft",
      senderId,
      subject: subject.slice(0, 998),
      previewText: previewText.slice(0, 255) || null,
      html,
      audienceId,
    })
    .returning({ id: broadcasts.id });

  redirect(`/broadcasts/${row!.id}?project=${scope.project.id}`);
}

export async function saveBroadcastAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const scope = await requireProject(projectId);
  const db = getDb();
  await db
    .update(broadcasts)
    .set({
      name: String(formData.get("name") ?? "").slice(0, 255),
      subject: String(formData.get("subject") ?? "").slice(0, 998),
      previewText: String(formData.get("previewText") ?? "").slice(0, 255) || null,
      html: String(formData.get("html") ?? ""),
      updatedAt: new Date(),
    })
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.projectId, scope.project.id)));
  revalidatePath(`/broadcasts/${broadcastId}`);
}

export async function sendBroadcastAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const scope = await requireProject(projectId);
  const result = await dispatchBroadcast(scope.project.id, broadcastId);
  revalidatePath(`/broadcasts/${broadcastId}`);
  if (!result.ok) throw new Error(result.error ?? "Send failed.");
}

export async function testBroadcastAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const to = String(formData.get("to") ?? "");
  const scope = await requireProject(projectId);
  const result = await sendBroadcastTest(scope.project.id, broadcastId, to);
  if (!result.ok) throw new Error(result.error ?? "Test send failed.");
  revalidatePath(`/broadcasts/${broadcastId}`);
}

export async function cancelBroadcastAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const scope = await requireProject(projectId);
  const result = await cancelBroadcast(scope.project.id, broadcastId);
  if (!result.ok) throw new Error(result.error ?? "Cancel failed.");
  revalidatePath(`/broadcasts/${broadcastId}`);
}

/** Everything the detail page renders: the row plus per-status counts. */
export async function broadcastDetail(projectId: string, broadcastId: string) {
  const scope = await requireProject(projectId);
  const db = getDb();
  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.projectId, scope.project.id)))
    .limit(1);
  if (!broadcast) return null;

  const rows = await db
    .select({
      status: broadcastRecipients.status,
      skipReason: broadcastRecipients.skipReason,
      total: count(),
    })
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.broadcastId, broadcast.id))
    .groupBy(broadcastRecipients.status, broadcastRecipients.skipReason);

  const by = (status: string) =>
    rows.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.total), 0);

  return {
    broadcast,
    counts: {
      total: rows.reduce((sum, row) => sum + Number(row.total), 0),
      pending: by("pending"),
      queued: by("queued"),
      sent: by("sent"),
      delivered: by("delivered"),
      bounced: by("bounced"),
      failed: by("failed"),
      skipped: by("skipped"),
      cancelled: by("cancelled"),
      skippedByReason: rows
        .filter((row) => row.status === "skipped")
        .map((row) => ({ reason: row.skipReason ?? "unknown", total: Number(row.total) })),
    },
  };
}

/** List page data: broadcasts plus how many recipients each one queued. */
export async function broadcastList(projectId: string) {
  const scope = await requireProject(projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: broadcasts.id,
      name: broadcasts.name,
      subject: broadcasts.subject,
      status: broadcasts.status,
      createdAt: broadcasts.createdAt,
      startedAt: broadcasts.startedAt,
      completedAt: broadcasts.completedAt,
      recipientCount: broadcasts.recipientCount,
      audiences: sql<string>`(select name from audiences where id = ${broadcasts.audienceId})`,
    })
    .from(broadcasts)
    .where(eq(broadcasts.projectId, scope.project.id))
    .orderBy(sql`${broadcasts.createdAt} desc`)
    .limit(100);
  return { projectId: scope.project.id, rows };
}
