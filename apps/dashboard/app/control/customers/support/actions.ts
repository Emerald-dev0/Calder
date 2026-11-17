"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLogs, getDb, triageAcknowledgements } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { fingerprintOf } from "@/lib/control/acknowledgements";
import { triageQueue } from "@/lib/control/queries";

/**
 * Support queue memory: "I have looked at this".
 *
 * Two rules make this more than a hide button, and both are enforced here
 * rather than trusted from the form:
 *
 *  1. The fingerprint is recomputed from the live queue. The hidden field the
 *     browser submitted is only a claim about what the operator saw; if the
 *     condition changed in between (a domain failed while the page was open),
 *     the action refuses and sends them back to read it. Acknowledging
 *     evidence you were never shown is how a queue stops being trustworthy.
 *
 *  2. Nothing is deleted. Acknowledging inserts an append-only row, reopening
 *     stamps the newest one. The audit log records both, so "who decided this
 *     was fine, and when" is answerable later.
 */

const PAGE = "/control/customers/support";

function back(code: string): never {
  redirect(`${PAGE}?ack=${encodeURIComponent(code)}`);
}

function clip(value: FormDataEntryValue | null, max: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export async function acknowledgeItem(formData: FormData): Promise<void> {
  const ctx = await requireSection("customers");
  const itemId = clip(formData.get("itemId"), 200);
  const submitted = clip(formData.get("fingerprint"), 64);
  const note = clip(formData.get("note"), 1000);
  if (!itemId) back("missing");

  const queue = await triageQueue();
  const current = queue.items.find((item) => item.id === itemId);

  if (!current) {
    // Either the item resolved itself (good news) or it is already covered by
    // a live acknowledgement. Both are "nothing to do", but they read
    // differently to an operator, so the page says which.
    const covered = queue.acknowledged.some((entry) => entry.item.id === itemId);
    back(covered ? "already" : "gone");
  }

  const fingerprint = fingerprintOf(current);
  if (submitted && submitted !== fingerprint) back("changed");

  const db = getDb();
  await db.insert(triageAcknowledgements).values({
    id: `ack_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    itemId: current.id,
    kind: current.kind,
    title: current.title,
    fingerprint,
    note: note || null,
    acknowledgedByUserId: ctx.user.userId,
  });

  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId: ctx.user.userId,
      action: "triage.acknowledged",
      targetType: "triage_item",
      targetId: current.id,
      metadata: {
        kind: current.kind,
        severity: current.severity,
        organizationName: current.organizationName,
        note: note || null,
      },
    });
  } catch {
    // The acknowledgement is written; losing the audit row must not present
    // the click as failed and invite a second one.
  }

  revalidatePath(PAGE);
  back("saved");
}

export async function reopenItem(formData: FormData): Promise<void> {
  const ctx = await requireSection("customers");
  const ackId = clip(formData.get("ackId"), 64);
  if (!ackId) back("missing");

  const db = getDb();
  const [updated] = await db
    .update(triageAcknowledgements)
    .set({ reopenedAt: new Date(), reopenedByUserId: ctx.user.userId })
    .where(and(eq(triageAcknowledgements.id, ackId), isNull(triageAcknowledgements.reopenedAt)))
    .returning({
      itemId: triageAcknowledgements.itemId,
      kind: triageAcknowledgements.kind,
    });

  if (updated) {
    try {
      await db.insert(auditLogs).values({
        id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        actorUserId: ctx.user.userId,
        action: "triage.reopened",
        targetType: "triage_item",
        targetId: updated.itemId,
        metadata: { kind: updated.kind, acknowledgementId: ackId },
      });
    } catch {
      // Same reasoning as above: the state change already happened.
    }
  }

  revalidatePath(PAGE);
  back(updated ? "reopened" : "missing");
}
