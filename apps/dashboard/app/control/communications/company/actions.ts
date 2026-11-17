"use server";

import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
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
  parseAudience,
  parseSelectedAddresses,
  requiresUnverifiedConfirmation,
} from "@/lib/control/audience";
import {
  batchKeyFor,
  mailedUserIds,
  recipientKeyFor,
  resolveSelectedUsers,
} from "@/lib/control/audience-recipients";
import { batchProgress, nextRecipients, runSize } from "@/lib/control/company-send";
import { findCompanySender } from "@/lib/control/senders";

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
 *  - the From line is one of the deployment's declared senders, never free text;
 *  - the batch key is derived from the content, so a double submit collapses
 *    onto the same rows instead of mailing everybody twice.
 *
 * A run sends at most `runSize()` recipients. That bounds one *request*, not who
 * can be reached: recipients this batch has already reached are excluded from
 * the next run, so a list of any size is finished by pressing the button again
 * and the page says how many are left. The previous shape refused outright above
 * 500 with "split the audience" — an instruction the console gave no way to
 * follow.
 */

const SENDABLE = ["updates.announcement", "updates.product_update"] as const;
type Sendable = (typeof SENDABLE)[number];

function redirectParams(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  return params.toString();
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

  // From. An unknown address is a refusal, not a fallback: sending from an
  // address other than the one on screen is the lie this console exists to avoid.
  const sender = findCompanySender(formData.get("from"));
  if (!sender) {
    throw new Error(
      "Choose a sending address from the list. Nothing was sent — Calder only sends from addresses its deployment declares."
    );
  }

  // Who.
  const audience = parseAudience(formData.get("audience"));
  const selectedRaw = String(formData.get("selected") ?? "");
  let selectedIds: string[] = [];
  if (audience === "selected") {
    const { addresses, truncated } = parseSelectedAddresses(selectedRaw);
    if (truncated) throw new Error("Too many names in one run: name at most 500 addresses.");
    if (addresses.length === 0) {
      throw new Error("Name at least one account, or choose a different audience.");
    }
    const resolution = await resolveSelectedUsers(getDb(), addresses);
    if (resolution.unmatched.length > 0) {
      const named = resolution.unmatched.slice(0, 8).join(", ");
      const more =
        resolution.unmatched.length > 8 ? ` and ${resolution.unmatched.length - 8} more` : "";
      throw new Error(
        `These addresses belong to no Calder account, so they cannot be mailed: ${named}${more}. Remove them, or invite those people first.`
      );
    }
    selectedIds = resolution.matched.map((row) => row.id);
  }

  // Render once before the first recipient: a template error must not
  // half-send, and the rendered document is what the preview showed.
  renderDraftPreview(template, draft);

  const db = getDb();
  const batch = batchKeyFor(template, title, body);
  const alreadyMailed = await mailedUserIds(db, batch);
  const limit = runSize();
  const candidates = await nextRecipients(db, {
    scope: audience,
    selectedIds,
    mailedIds: alreadyMailed,
    // One extra row is how we know there is more to do without counting twice.
    limit: limit + 1,
  });

  if (candidates.length === 0) {
    // Nothing left: say so, rather than reporting a phantom batch of zero.
    redirect(
      `/control/communications/company?${redirectParams({
        template,
        audience,
        from: sender.email,
        done: 1,
        remaining: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
      })}`
    );
  }

  const run = candidates.slice(0, limit);
  const unverifiedInRun = run.filter((row) => row.emailVerifiedAt === null).length;

  // The unverified acknowledgement is computed from the recipients actually in
  // this run, so it applies to a hand-picked list too. The risk is a property of
  // the addresses, not of the menu item that produced them.
  if (
    requiresUnverifiedConfirmation(unverifiedInRun) &&
    formData.get("confirmUnverified") !== "on"
  ) {
    throw new Error(
      "Confirm that you understand the wide audience includes unverified addresses before sending."
    );
  }

  // Pre-read consent so the operator's summary is honest before the first send.
  const disabled = await db
    .select({ userId: emailPreferences.userId, categories: emailPreferences.disabledCategories })
    .from(emailPreferences)
    .where(
      inArray(
        emailPreferences.userId,
        run.map((recipient) => recipient.id)
      )
    );
  const optedOut = new Set(
    disabled
      .filter((row) => (row.categories ?? []).includes(definition.category))
      .map((row) => row.userId)
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let replayed = 0;

  for (const recipient of run) {
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
      from: sender.label,
      idempotencyKey: recipientKeyFor(batch, recipient.id),
      data: personalisedEmailData(draft, { name: recipient.name }),
    });
    // A replay is a row that already exists: nothing was sent, so nothing may be
    // counted as sent. The old shape counted it as sent, which let a same-day
    // re-run report a full batch that never left the building.
    if (result.replay) replayed += 1;
    else if (result.status === "sent") sent += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
  }

  const progress = await batchProgress(db, {
    scope: audience,
    selectedIds,
    mailedIds: new Set([...alreadyMailed, ...run.map((row) => row.id)]),
  });

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
        from: sender.email,
        recipients: run.length,
        sent,
        skipped,
        failed,
        replayed,
        remaining: progress.remaining,
      },
    });
  } catch {
    // The sends already happened; an audit write failure must not hide them.
  }

  revalidatePath("/control/communications/company");
  redirect(
    `/control/communications/company?${redirectParams({
      sent,
      skipped,
      failed,
      replayed,
      remaining: progress.remaining,
      template,
      title,
      body,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
      audience,
      // Keep the named list so "send the rest" is one click with the same people,
      // instead of retyping an audience the page already proved.
      selected: audience === "selected" ? selectedRaw : undefined,
      from: sender.email,
    })}`
  );
}

/**
 * One person, to check the thing renders in a real client before it is sent to
 * everyone. Always the operator's own address, never an arbitrary one — and
 * through the same sender the batch will use, because "it looked fine" is worth
 * nothing if the batch leaves from a different address.
 */
export async function sendTestToSelf(formData: FormData) {
  const ctx = await requireSection("communications");
  const template = String(formData.get("template") ?? "") as Sendable;
  if (!SENDABLE.includes(template)) throw new Error("Unknown template.");

  const sender = findCompanySender(formData.get("from"));
  if (!sender) throw new Error("Choose a sending address from the list first.");

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
    .where(inArray(users.id, [ctx.user.userId]))
    .limit(1);

  await sendCompanyEmail(db, {
    id: template,
    to: ctx.email,
    userId: ctx.user.userId,
    from: sender.label,
    idempotencyKey: `operator-test:${template}:${ctx.user.userId}:${Date.now()}`,
    // Marked so the catalogue's "last sent" evidence cannot count a note to
    // yourself as a send to customers.
    data: { ...personalisedEmailData(draft, { name: self?.name ?? null }), operatorTest: true },
  });

  revalidatePath("/control/communications/company");
  redirect("/control/communications/company?test=1");
}
