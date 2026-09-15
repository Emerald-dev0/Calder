"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import {
  auditLogs,
  emailEvents,
  emails,
  waitlistConfirmation,
  waitlistConfirmationDrafts,
  waitlistConfirmationVersions,
} from "@calder/db";
import { getDb } from "@calder/db";
import { brandEmail } from "@calder/email";
import { createQueue } from "@calder/queue";
import { requireControl } from "./guard";
import { READ_ONLY_ROLES } from "./roles";

/**
 * Confirmation email editor backend (SRS REQ-070..075, DEC-005).
 *
 * - The materialized `waitlist_confirmation` row remains what the API send
 *   path reads; publishing materializes the draft into it (send path untouched).
 * - Every publish writes an immutable version row; restore copies a version
 *   into the draft. History is never overwritten.
 * - Send test enqueues exactly one internal email under proj_website, marked
 *   [TEST] in the subject, and never touches waitlist signups or analytics.
 * - All actions are operator-gated (no read-only roles) and audit-logged.
 */

const INTERNAL_PROJECT = "proj_website";
const INTERNAL_FROM = "Calder <hello@calder.click>";
const SAMPLE_NAME = "Sarah";

export interface EditorState {
  subject: string;
  html: string;
  text: string;
  updatedAt: string | null;
  currentVersion: number | null;
  currentPublishedAt: string | null;
  hasDraft: boolean;
  versions: Array<{
    id: string;
    version: number;
    subject: string;
    publishedAt: string;
    publishedBy: string | null;
  }>;
}

async function requireOperator() {
  const ctx = await requireControl();
  if ((READ_ONLY_ROLES as string[]).includes(ctx.role)) {
    throw new Error("Read-only role: analysts cannot modify the confirmation email.");
  }
  return ctx;
}

async function audit(actorUserId: string, action: string, metadata: Record<string, unknown>) {
  const db = getDb();
  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId,
      action,
      targetType: "waitlist_confirmation",
      targetId: "internal",
      metadata,
    });
  } catch {
    // Audit must never break the operation it records.
  }
}

function renderSample(s: string): string {
  return s.replaceAll("{{first_name}}", SAMPLE_NAME);
}

export async function getEditorState(): Promise<EditorState> {
  await requireControl();
  const db = getDb();
  const [current, draft, versions] = await Promise.all([
    db.select().from(waitlistConfirmation).where(eq(waitlistConfirmation.id, "internal")).limit(1),
    db
      .select()
      .from(waitlistConfirmationDrafts)
      .where(eq(waitlistConfirmationDrafts.id, "internal"))
      .limit(1),
    db
      .select({
        id: waitlistConfirmationVersions.id,
        version: waitlistConfirmationVersions.version,
        subject: waitlistConfirmationVersions.subject,
        publishedAt: waitlistConfirmationVersions.publishedAt,
        publishedBy: waitlistConfirmationVersions.publishedBy,
      })
      .from(waitlistConfirmationVersions)
      .orderBy(desc(waitlistConfirmationVersions.version))
      .limit(30),
  ]);

  const cur = current[0];
  const draftRow = draft[0];
  const latestVersion = versions[0] ?? null;
  return {
    subject: draftRow?.subject ?? cur?.subject ?? "",
    html: draftRow?.html ?? cur?.html ?? "",
    text: draftRow?.text ?? cur?.text ?? "",
    updatedAt: (draftRow ?? cur)?.updatedAt?.toISOString() ?? null,
    currentVersion: latestVersion?.version ?? null,
    currentPublishedAt: latestVersion?.publishedAt.toISOString() ?? null,
    hasDraft: !!draftRow,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      subject: v.subject,
      publishedAt: v.publishedAt.toISOString(),
      publishedBy: v.publishedBy,
    })),
  };
}

export async function saveDraft(input: {
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true }> {
  const ctx = await requireOperator();
  if (!input.subject.trim()) throw new Error("Subject can't be empty.");
  if (!input.html.trim()) throw new Error("HTML body can't be empty.");
  const db = getDb();
  const now = new Date();
  await db
    .insert(waitlistConfirmationDrafts)
    .values({
      id: "internal",
      subject: input.subject,
      html: input.html,
      text: input.text,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: waitlistConfirmationDrafts.id,
      set: { subject: input.subject, html: input.html, text: input.text, updatedAt: now },
    });
  await audit(ctx.user.userId, "confirmation_email.save_draft", {
    subjectLength: input.subject.length,
  });
  revalidatePath("/control/email-editor");
  return { ok: true };
}

export async function publishEmail(input: {
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true; version: number }> {
  const ctx = await requireOperator();
  if (!input.subject.trim() || !input.html.trim())
    throw new Error("Subject and HTML are required.");
  const db = getDb();
  const now = new Date();

  const [maxRow] = await db
    .select({ value: waitlistConfirmationVersions.version })
    .from(waitlistConfirmationVersions)
    .orderBy(desc(waitlistConfirmationVersions.version))
    .limit(1);
  const nextVersion = (maxRow?.value ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx.insert(waitlistConfirmationVersions).values({
      id: `wcv_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      version: nextVersion,
      subject: input.subject,
      html: input.html,
      text: input.text,
      publishedBy: ctx.email,
      publishedAt: now,
    });
    await tx
      .insert(waitlistConfirmation)
      .values({
        id: "internal",
        subject: input.subject,
        html: input.html,
        text: input.text,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: waitlistConfirmation.id,
        set: { subject: input.subject, html: input.html, text: input.text, updatedAt: now },
      });
    await tx
      .delete(waitlistConfirmationDrafts)
      .where(eq(waitlistConfirmationDrafts.id, "internal"));
  });

  await audit(ctx.user.userId, "confirmation_email.publish", { version: nextVersion });
  revalidatePath("/control/email-editor");
  revalidatePath("/control");
  return { ok: true, version: nextVersion };
}

export async function restoreVersion(version: number): Promise<{ ok: true }> {
  const ctx = await requireOperator();
  const db = getDb();
  const [row] = await db
    .select()
    .from(waitlistConfirmationVersions)
    .where(eq(waitlistConfirmationVersions.version, version))
    .limit(1);
  if (!row) throw new Error(`Version ${version} does not exist.`);
  const now = new Date();
  await db
    .insert(waitlistConfirmationDrafts)
    .values({
      id: "internal",
      subject: row.subject,
      html: row.html,
      text: row.text,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: waitlistConfirmationDrafts.id,
      set: { subject: row.subject, html: row.html, text: row.text, updatedAt: now },
    });
  await audit(ctx.user.userId, "confirmation_email.restore", { version });
  revalidatePath("/control/email-editor");
  return { ok: true };
}

export async function discardDraft(): Promise<{ ok: true }> {
  const ctx = await requireOperator();
  const db = getDb();
  await db.delete(waitlistConfirmationDrafts).where(eq(waitlistConfirmationDrafts.id, "internal"));
  await audit(ctx.user.userId, "confirmation_email.discard_draft", {});
  revalidatePath("/control/email-editor");
  return { ok: true };
}

export async function sendTestEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true; emailId: string }> {
  const ctx = await requireOperator();
  const to = input.to.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
    throw new Error("Enter a valid test recipient address.");

  const db = getDb();
  const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const renderedHtml = renderSample(input.html);
  const renderedText = renderSample(input.text);
  const subject = `[TEST] ${input.subject}`;

  await db.transaction(async (tx) => {
    await tx.insert(emails).values({
      id: emailId,
      projectId: INTERNAL_PROJECT,
      from: INTERNAL_FROM,
      to,
      subject,
      html: brandEmail(renderedHtml, { preheader: subject }),
      text: renderedText,
      status: "queued",
      metadata: { test: true, via: "confirmation-email-editor" },
    });
    await tx.insert(emailEvents).values({
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId,
      projectId: INTERNAL_PROJECT,
      type: "queued",
      data: { via: "confirmation-email-editor", test: true },
    });
  });

  const queue = createQueue<{ emailId: string; projectId: string }>("email:send", {
    maxAttempts: 5,
  });
  await queue.enqueue("send-email", { emailId, projectId: INTERNAL_PROJECT });

  // REQ-074: test sends never touch waitlist_signups or analytics_events.
  await audit(ctx.user.userId, "confirmation_email.send_test", { to, emailId });
  revalidatePath("/control/email-editor");
  return { ok: true, emailId };
}
