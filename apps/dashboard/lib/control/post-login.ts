import { eq } from "drizzle-orm";
import { getDb, users, type PlatformRole } from "@calder/db";
import { getConfig } from "@calder/config";
import { resolvePlatformRole } from "./roles";

/**
 * Post-login routing for the founder Control Plane.
 *
 * The decision is always derived server-side from the authenticated session
 * email + the platform-role system (`resolvePlatformRole`: explicit DB
 * founder role first, then the FOUNDER_EMAILS bootstrap). Callers (login,
 * OTP-verify, OAuth/magic-link/dev-login callbacks) only follow the returned
 * path — they never compare emails themselves.
 *
 * - Founder/operators  → `/control` (the Command Center landing page).
 * - Regular customers   → `/` (the normal application dashboard).
 * - A safe `?next=` deep link is honored, except `/control*` targets which
 *   require Control Plane access (otherwise they would bounce back to login).
 */

export interface PostLoginTargetInput {
  email: string;
  dbRole: PlatformRole | null;
  founderEmails: string | undefined;
  next?: string | null;
}

/** Accept only same-origin absolute paths; reject open-redirect shapes. */
export function sanitizeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/** Pure target resolution — unit-tested, no I/O. */
export function resolvePostLoginTarget(input: PostLoginTargetInput): string {
  const email = input.email.toLowerCase().trim();
  const hasAccess = resolvePlatformRole(email, input.dbRole, input.founderEmails) !== null;
  const safe = sanitizeNext(input.next);
  if (safe) {
    if (!safe.startsWith("/control")) return safe;
    return hasAccess ? safe : "/";
  }
  return hasAccess ? "/control" : "/";
}

async function dbRoleForEmail(email: string): Promise<PlatformRole | null> {
  const normalized = email.toLowerCase().trim();
  const db = getDb();
  const [row] = await db
    .select({ platformRole: users.platformRole })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  return row?.platformRole ?? null;
}

/** Server-side check: does this authenticated email hold any platform role? */
export async function hasControlAccess(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const dbRole = await dbRoleForEmail(normalized);
  return resolvePlatformRole(normalized, dbRole, getConfig().FOUNDER_EMAILS) !== null;
}

/** Full server-side helper for auth routes: email (+ optional next) → path. */
export async function postLoginRedirect(email: string, next?: string | null): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const dbRole = await dbRoleForEmail(normalized);
  return resolvePostLoginTarget({
    email: normalized,
    dbRole,
    founderEmails: getConfig().FOUNDER_EMAILS,
    next,
  });
}
