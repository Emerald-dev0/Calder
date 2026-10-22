import { randomUUID } from "node:crypto";
import { getDb } from "@calder/db";
import { sendCompanyEmailQuietly, type CompanyEmailId } from "@calder/notify";

/**
 * Security notifications.
 *
 * The copy lives in the company email catalogue (`@calder/notify`), not here.
 * This module is only the mapping from an auth event to a template, so a
 * password change and a "new sign-in" cannot drift apart in tone, and every
 * notice lands in `company_emails` where support can find it.
 *
 * Delivery failures are logged and swallowed: the security operation already
 * happened and must not be rolled back because an inbox is unreachable.
 */

export type SecurityEmailEvent =
  | "new_login"
  | "password_changed"
  | "password_reset"
  | "oauth_connected"
  | "oauth_disconnected";

const TEMPLATE: Record<SecurityEmailEvent, CompanyEmailId> = {
  new_login: "account.new_sign_in",
  password_changed: "account.password_changed",
  password_reset: "account.password_reset_completed",
  oauth_connected: "account.sign_in_method_added",
  oauth_disconnected: "account.sign_in_method_removed",
};

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

export async function sendSecurityEmail(opts: {
  to: string;
  event: SecurityEmailEvent;
  /** OAuth provider name, when the event concerns one. */
  provider?: string;
  userId?: string | null;
  ip?: string | null;
  device?: string | null;
  /** Pass the id of the thing that caused this (session, request) when you have it. */
  eventId?: string;
}): Promise<void> {
  const template = TEMPLATE[opts.event];

  await sendCompanyEmailQuietly(getDb(), {
    id: template,
    to: opts.to,
    userId: opts.userId ?? null,
    // One notice per event. Callers that have a session id pass it; otherwise a
    // random suffix is correct, because two sign-ins really are two events.
    idempotencyKey: `security:${opts.event}:${opts.eventId ?? randomUUID()}`,
    data: {
      when: formatWhen(new Date()),
      ip: opts.ip ?? undefined,
      device: opts.device ?? undefined,
      method: opts.provider ? `oauth:${opts.provider}` : undefined,
      provider: opts.provider,
    },
  });
}
