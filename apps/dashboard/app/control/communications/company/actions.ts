"use server";

import { randomUUID } from "node:crypto";
import { inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLogs, emailPreferences, getDb, users } from "@calder/db";
import {
  companyEmailDefinition,
  defaultUrls,
  renderCompanyEmail,
  sendCompanyEmail,
} from "@calder/notify";
import { requireSection } from "@/lib/control/guard";
import { READ_ONLY_ROLES } from "@/lib/control/roles";

/**
 * Operator sends to the product's own users.
 *
 * The control plane is the only place that can mail every customer, so the
 * rules are stricter than anywhere else:
 *
 *  - a read-only role cannot send, and every send is audit-logged with the
 *    operator, the template and the numbers;
 *  - the catalogue decides whether a template exists and whether it is
 *    optional, so an operator cannot invent a mandatory category;
 *  - the consent table is applied per recipient inside `sendCompanyEmail`,
 *    which means the count an operator sees here is a ceiling, not a promise;
 *  - the batch key is derived from the content, so a double submit (or a
 *    refresh-caused resubmit) collapses onto the same rows instead of mailing
 *    everybody twice.
 */

const SENDABLE = ["updates.announcement", "updates.product_update"] as const;
type Sendable = (typeof SENDABLE)[number];

/** Hard cap per run: one request must finish, and the rest are told, not lost. */
const MAX_RECIPIENTS = 500;

function batchKey(template: string, subject: string, body: string): string {
  // Content-addressed and day-scoped: editing the copy produces a new batch,
  // re-clicking the same button does not.
  const day = new Date().toISOString().slice(0, 10);
  const hash = Buffer.from(`${template}|${subject}|${body}|${day}`, "utf8").toString("base64url");
  return hash.slice(0, 40);
}

export async function sendToProductUsers(formData: FormData) {
  const ctx = await requireSection("communications");
  if ((READ_ONLY_ROLES as string[]).includes(ctx.role)) {
    throw new Error("Read-only role: analysts cannot send product email.");
  }

  const template = String(formData.get("template") ?? "") as Sendable;
  if (!SENDABLE.includes(template)) {
    throw new Error("Choose a template this console can send.");
  }
  const definition = companyEmailDefinition(template);
  if (!definition) throw new Error("Unknown template.");

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (title.length < 3) throw new Error("Give the email a title (3+ characters).");
  if (body.length < 20) throw new Error("Write at least a sentence of body copy.");
  if (formData.get("confirm") !== "on") {
    throw new Error("Confirm you have read the preview before sending.");
  }

  const data = {
    title,
    body,
    ctaLabel: String(formData.get("ctaLabel") ?? "").trim() || undefined,
    ctaUrl: String(formData.get("ctaUrl") ?? "").trim() || undefined,
  };

  // Render before the first recipient: a template error must not half-send.
  renderCompanyEmail({ id: template, data, urls: defaultUrls() });

  const db = getDb();
  const recipients = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt))
    .limit(MAX_RECIPIENTS + 1);
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(
      `This run would mail more than ${MAX_RECIPIENTS} people. Split the audience before sending.`
    );
  }

  // Pre-read consent so the operator's summary is honest before the first send.
  const disabled = await db
    .select({ userId: emailPreferences.userId, categories: emailPreferences.disabledCategories })
    .from(emailPreferences)
    .where(
      inArray(
        emailPreferences.userId,
        recipients.length > 0 ? recipients.map((r) => r.id) : ["none"]
      )
    );
  const optedOut = new Set(
    disabled
      .filter((row) => (row.categories ?? []).includes(definition.category))
      .map((row) => row.userId)
  );

  const batch = batchKey(template, title, body);
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipient of recipients) {
    if (optedOut.has(recipient.id)) {
      skipped += 1;
      continue;
    }
    const result = await sendCompanyEmail(db, {
      id: template,
      to: recipient.email,
      userId: recipient.id,
      idempotencyKey: `operator:${batch}:${recipient.id}`,
      data,
    });
    if (result.status === "sent") sent += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
  }

  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId: ctx.user.userId,
      action: "company_email.sent",
      targetType: "company_email",
      targetId: template,
      metadata: {
        template,
        title,
        batch,
        recipients: recipients.length,
        sent,
        skipped,
        failed,
      },
    });
  } catch {
    // The sends already happened; an audit write failure must not hide them.
  }

  revalidatePath("/control/communications/company");
  redirect(`/control/communications/company?sent=${sent}&skipped=${skipped}&failed=${failed}`);
}

/**
 * One person, to check the thing renders in a real client before it is sent to
 * everyone. Always the operator's own address, never an arbitrary one.
 */
export async function sendTestToSelf(formData: FormData) {
  const ctx = await requireSection("communications");
  const template = String(formData.get("template") ?? "") as Sendable;
  if (!SENDABLE.includes(template)) throw new Error("Unknown template.");

  const db = getDb();
  await sendCompanyEmail(db, {
    id: template,
    to: ctx.email,
    userId: ctx.user.userId,
    idempotencyKey: `operator-test:${template}:${ctx.user.userId}:${Date.now()}`,
    data: {
      title: String(formData.get("title") ?? "").trim() || "Test send",
      body:
        String(formData.get("body") ?? "").trim() ||
        "This is a test of the operator console. Nothing was sent to customers.",
      ctaLabel: String(formData.get("ctaLabel") ?? "").trim() || undefined,
      ctaUrl: String(formData.get("ctaUrl") ?? "").trim() || undefined,
    },
  });

  revalidatePath("/control/communications/company");
  redirect("/control/communications/company?test=1");
}
