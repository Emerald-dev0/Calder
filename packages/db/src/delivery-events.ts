/**
 * Delivery-event ingress: the two facts a "0 delivered" claim needs.
 *
 * 1. When did a delivery event (delivered / bounced / complained) last arrive?
 * 2. How many messages were accepted in the same window?
 *
 * `@calder/observability` turns the pair into words; this file only measures,
 * so the API readiness route and the dashboard cannot disagree about the raw
 * numbers. Both queries are covered by the indexes added in migration 0031:
 * - the last-event lookup stops at the first row of `email_events_type_created_idx`
 *   (or of its project-prefixed sibling);
 * - the accepted count narrows on the existing `emails_project_idx` / `emails_status_idx`
 *   and filters the window in place — no new scan of the whole table.
 */

import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { emailEvents, emails } from "./schema/emails.js";
import { providerEvents } from "./schema/providers.js";

/**
 * Event types that mean SES reported back. Only the SES feedback ingress
 * writes these (`data.source = "ses-feedback"`), so the type alone identifies
 * the channel and no JSON predicate (and no JSON index) is needed.
 */
export const DELIVERY_EVENT_TYPES = ["delivered", "bounced", "complained"] as const;

/** Statuses the provider accepted. Matches the stream cards' definition. */
export const ACCEPTED_DELIVERY_STATUSES = ["sent", "delivered", "bounced", "complained"] as const;

export interface DeliveryEventIngress {
  /** Newest *applied* delivery event (one that reached a Calder email row). */
  lastDeliveryEventAt: Date | null;
  /** Messages accepted for delivery since `since`. */
  acceptedInWindow: number;
  /**
   * Newest raw SES event in the ledger, matched or not.
   *
   * This is the fact that separates two completely different failures that used
   * to look identical: "SNS is not reaching us" (nothing in the ledger) versus
   * "SNS reaches us but nothing matches a Calder send" (ledger full, no email
   * touched). Only the first is a wiring problem.
   */
  lastRawEventAt: Date | null;
  /**
   * Raw events in the window that matched no Calder email. Unattributed rows
   * carry no project, so this is only counted for account-wide (unscoped)
   * callers; a tenant dashboard cannot honestly claim them.
   */
  unmatchedInWindow: number;
}

export async function deliveryEventIngress(
  db: DbClient,
  opts: { since: Date; projectId?: string }
): Promise<DeliveryEventIngress> {
  const scope = opts.projectId;

  const [lastEventRows, acceptedRows, lastRawRows, unmatchedRows] = await Promise.all([
    db
      .select({ at: sql<Date | null>`max(${emailEvents.createdAt})` })
      .from(emailEvents)
      .where(
        and(
          inArray(emailEvents.type, [...DELIVERY_EVENT_TYPES]),
          ...(scope ? [eq(emailEvents.projectId, scope)] : [])
        )
      ),
    db
      .select({ value: count() })
      .from(emails)
      .where(
        and(
          gte(emails.createdAt, opts.since),
          inArray(emails.status, [...ACCEPTED_DELIVERY_STATUSES]),
          ...(scope ? [eq(emails.projectId, scope)] : [])
        )
      ),
    // Raw ingress, matched or not. Scoped when a project is asked about, so a
    // tenant only ever sees its own traffic.
    db
      .select({ at: sql<Date | null>`max(${providerEvents.createdAt})` })
      .from(providerEvents)
      .where(scope ? eq(providerEvents.projectId, scope) : undefined),
    // Unattributed rows carry no project, so only an account-wide caller can
    // count them; a project-scoped caller gets zero rather than a guess.
    scope
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(providerEvents)
          .where(
            and(gte(providerEvents.createdAt, opts.since), eq(providerEvents.unmatched, true))
          ),
  ]);

  const raw = lastEventRows[0]?.at ?? null;
  const rawAny = lastRawRows[0]?.at ?? null;
  return {
    // The driver can hand back a string for an aggregate; normalise once here
    // rather than at every call site.
    lastDeliveryEventAt: raw ? new Date(raw) : null,
    acceptedInWindow: Number(acceptedRows[0]?.value ?? 0),
    lastRawEventAt: rawAny ? new Date(rawAny) : null,
    unmatchedInWindow: Number(unmatchedRows[0]?.value ?? 0),
  };
}
