"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attemptVerification, auditLogs, domains, getDb } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { READ_ONLY_ROLES } from "@/lib/control/roles";

/**
 * Re-check a domain's DNS ownership proof from the Control Plane.
 *
 * This is the resolution path for the most common support item — a customer
 * says "the record is published now" — and it calls the *same*
 * `attemptVerification` the customer-facing `POST /v1/domains/:id/verify`
 * calls. There is no second implementation, so the rolling attempt window,
 * the challenge expiry and the TXT comparison behave identically no matter who
 * pressed the button. The rate limit is deliberately shared: an operator
 * clicking five times in an hour is the same hammering as a customer doing it,
 * and the sixth attempt is refused with the number of seconds to wait.
 *
 * Two deliberate omissions, both visible on the page:
 *
 *  - it does not email the customer. The customer-facing endpoint notifies
 *    organisers because they took the action; an admin re-check that silently
 *    mails a customer is a surprise, and it would also let an operator generate
 *    mail by clicking. The state change is visible in the customer's own
 *    dashboard either way.
 *  - it changes nothing the operator could not point at: no record is edited,
 *    no status invented. The outcome is whatever DNS says.
 */

const PAGE = "/control/customers/domains";

function back(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`${PAGE}?${qs}`);
}

export async function reverifyDomain(formData: FormData): Promise<void> {
  const ctx = await requireSection("customers");
  if ((READ_ONLY_ROLES as string[]).includes(ctx.role)) {
    back({ verify: "forbidden" });
  }

  const domainId = String(formData.get("domainId") ?? "")
    .trim()
    .slice(0, 64);
  const projectId = String(formData.get("projectId") ?? "")
    .trim()
    .slice(0, 64);
  if (!domainId || !projectId) back({ verify: "missing" });

  const db = getDb();
  const [row] = await db
    .select({ domain: domains.domain })
    .from(domains)
    .where(eq(domains.id, domainId))
    .limit(1);
  if (!row) back({ verify: "missing" });

  const outcome = await attemptVerification(db, projectId, domainId);

  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId: ctx.user.userId,
      action: "domain.reverified",
      targetType: "domain",
      targetId: domainId,
      metadata: {
        domain: row.domain,
        projectId,
        outcome: outcome.kind,
        ...(outcome.kind === "rate_limited" ? { retryAfterSec: outcome.retryAfterSec } : {}),
      },
    });
  } catch {
    // The DNS check already happened and the domain row may have changed; an
    // audit write failure must not hide either fact from the operator.
  }

  revalidatePath(PAGE);
  back({
    verify: outcome.kind,
    q: row.domain,
    ...(outcome.kind === "rate_limited" ? { wait: String(outcome.retryAfterSec) } : {}),
  });
}
