import { ORG_COOKIE } from "./context";

/**
 * The active-workspace cookie, as a header value.
 *
 * Route handlers cannot use the `cookies()` writer for everything they need
 * (they build a `Response` in one place), so the same attributes live here:
 * httpOnly, SameSite=Lax, one year, Secure in production.
 *
 * The value is only ever a hint. `lib/context.ts` validates it against the
 * caller's memberships on every render, so writing an id someone is not a
 * member of would simply be ignored — it grants nothing.
 */

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function orgCookieHeader(
  organizationId: string,
  env: { NODE_ENV?: string } = process.env
): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `${ORG_COOKIE}=${encodeURIComponent(organizationId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ONE_YEAR_SECONDS}${secure}`,
  ].join("; ");
}

/**
 * The workspace to open after a sign-in, if this login joined one by
 * invitation. `acceptPendingInvites` returns them newest first; the most recent
 * invitation is the one the person is most likely responding to.
 */
export function invitedOrgCookieHeader(
  invitedOrganizationIds: string[] | undefined,
  env: { NODE_ENV?: string } = process.env
): string | null {
  const first = invitedOrganizationIds?.[0];
  return first ? orgCookieHeader(first, env) : null;
}
