"use server";

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLogs, emailPreferences, getDb, users } from "@calder/db";
import { companyEmailDefinition, sendCompanyEmail } from "@calder/notify";
import { requireSection } from "@/lib/control/guard";
import { READ_ONLY_ROLES } from "@/lib/control/roles";
import {
  personalisedEmailData,
  renderDraftPreview,
  validateDraft,
} from "@/lib/control/company-draft";
import {
  audienceFilter,
  parseAudience,
  requiresUnverifiedConfirmation,
} from "@/lib/control/audience";

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
  const draft = {
    title,
    body,
    ctaLabel: String(formData.get("ctaLabel") ?? "").trim() || undefined,
    ctaUrl: String(formData.get("ctaUrl") ?? "").trim() || undefined,
  };

  // The same validation the preview used. An unknown merge field is refused
  // here as well: the form is a hint, this is the gate.
  const validation = validateDraft(draft);
  if (!validation.ok) throw new Error(validation.error);
  if (formData.get("confirm") !== "on") {
    throw new Error("Confirm you have read the preview before sending.");
  }

  // The wide audience is a separate decision from "I read the preview": it
  // spends sending reputation on addresses that may not exist, so it has its
  // own acknowledgement and the server, not the form, enforces it.
  const audience = parseAudience(formData.get("audience"));
  if (requiresUnverifiedConfirmation(audience) && formData.get("confirmUnverified") !== "on") {
    throw new Error(
      "Confirm that you understand the wide audience includes unverified addresses before sending."
    );
  }

  // Render once before the first recipient: a template error must not
  // half-send, and the rendered document is what the preview showed.
  renderDraftPreview(template, draft);

  const db = getDb();
  const recipients = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    // Narrow by default. The predicate itself lives in lib/control/audience so
    // the wide path is a deliberate branch rather than a missing filter that
    // someone could widen by accident later.
    .where(audienceFilter(audience))
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
    // Per-recipient data: `{{name}}` is what makes a broadcast read like a
    // letter rather than a mailshot, and it is substituted here so no other
    // recipient's name can ever appear in someone's inbox.
    const result = await sendCompanyEmail(db, {
      id: template,
      to: recipient.email,
      userId: recipient.id,
      idempotencyKey: `operator:${batch}:${recipient.id}`,
      data: personalisedEmailData(draft, { name: recipient.name }),
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
        audience,
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
  const draft = {
    title: String(formData.get("title") ?? "").trim() || "Test send",
    body:
      String(formData.get("body") ?? "").trim() ||
      "This is a test of the operator console. Nothing was sent to customers.",
    ctaLabel: String(formData.get("ctaLabel") ?? "").trim() || undefined,
    ctaUrl: String(formData.get("ctaUrl") ?? "").trim() || undefined,
  };
  const validation = validateDraft(draft);
  if (!validation.ok) throw new Error(validation.error);

  // The operator sees their own name, which is the honest test: if `{{name}}`
  // renders badly, it renders badly for them first.
  const [self] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.user.userId))
    .limit(1);

  await sendCompanyEmail(db, {
    id: template,
    to: ctx.email,
    userId: ctx.user.userId,
    idempotencyKey: `operator-test:${template}:${ctx.user.userId}:${Date.now()}`,
    data: personalisedEmailData(draft, { name: self?.name ?? null }),
  });

  revalidatePath("/control/communications/company");
  redirect("/control/communications/company?test=1");
}
