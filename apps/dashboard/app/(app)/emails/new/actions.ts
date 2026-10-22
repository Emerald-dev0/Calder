"use server";

import { getTenantContext } from "../../../../lib/auth";
import { sendTransactional } from "../../../../lib/send/transactional";

export interface ComposerAttachment {
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface ComposeInput {
  projectId: string;
  senderId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  replyTo?: string;
  scheduledAt?: string;
  attachments?: ComposerAttachment[];
}

/**
 * Composer send.
 *
 * This used to carry its own copy of the send pipeline — its own suppression
 * query (project-scoped, reason-blind), its own numeric limits and its own
 * persist/enqueue sequence. That copy is gone: everything now goes through
 * `sendTransactional`, the same service Resend uses, so the composer inherits
 * the shared suppression guard, the API's validation schema and the real plan
 * quota instead of a parallel approximation of them.
 *
 * What stays here is the part that is genuinely dashboard-specific: proving the
 * signed-in user may act on this project, and flattening the composer's array
 * fields into the single-value contract the email schema takes.
 */
export async function sendComposerEmail(
  input: ComposeInput
): Promise<{ ok: true; emailId: string }> {
  const ctx = await getTenantContext();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!projectIds.has(input.projectId)) throw new Error("Project not found.");

  const to = (input.to ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (to.length === 0) throw new Error("Add at least one To recipient.");
  if (to.length > 1) {
    throw new Error(
      "The composer sends one message at a time. Send to additional recipients separately, or use the API's batch endpoint."
    );
  }

  const result = await sendTransactional({
    projectId: input.projectId,
    senderId: input.senderId,
    to: to[0]!,
    cc: input.cc?.[0],
    bcc: input.bcc?.[0],
    subject: input.subject,
    text: input.text,
    replyTo: input.replyTo,
    scheduledAt: input.scheduledAt,
    attachments: input.attachments ?? null,
  });

  return { ok: true, emailId: result.id };
}
