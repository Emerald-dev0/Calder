import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "@calder/auth";
import { getDb, users, type PlatformRole } from "@calder/db";
import { getConfig } from "@calder/config";
import { canAccessSection, resolvePlatformRole, type ControlSection } from "./roles";

export interface ControlContext {
  user: SessionUser;
  email: string;
  role: PlatformRole;
}

/**
 * Control Plane session + role resolution. Cached per request.
 * Returns null for anyone who is not a platform operator — including
 * perfectly valid, fully logged-in customers. The Control Plane is a
 * separate operational surface, not a dashboard theme.
 */
export const getControlContext = cache(async (): Promise<ControlContext | null> => {
  const cookieStore = cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) return null;

  const db = getDb();
  const [row] = await db
    .select({ platformRole: users.platformRole })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);

  const role = resolvePlatformRole(
    user.email,
    row?.platformRole ?? null,
    getConfig().FOUNDER_EMAILS
  );
  if (!role) return null;
  return { user, email: user.email, role };
});

export async function requireControl(): Promise<ControlContext> {
  const ctx = await getControlContext();
  if (!ctx) redirect("/login?next=/control");
  return ctx;
}

/** Page guard: operator must hold the section the route belongs to. */
export async function requireSection(section: ControlSection): Promise<ControlContext> {
  const ctx = await requireControl();
  if (!canAccessSection(ctx.role, section)) redirect("/control/no-access");
  return ctx;
}
