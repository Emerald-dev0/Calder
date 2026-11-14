"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser, SESSION_COOKIE } from "@calder/auth";
import { ORG_COOKIE, PROJECT_COOKIE } from "../../../lib/context";
import {
  acceptInvitation,
  invitationDestination,
  logInvitationOutcome,
} from "../../../lib/invites";

/**
 * Accept an invitation as the signed-in user.
 *
 * Deliberately a server action rather than something that happens on page load:
 * joining a workspace is a membership grant, and a GET that grants access can
 * be triggered by any image tag, prefetcher or link preview. The form on the
 * page is the consent.
 */

const ONE_YEAR = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  };
}

export async function acceptInvitationAction(token: string): Promise<void> {
  const jar = await cookies();
  const viewer = await getSessionUser(jar.get(SESSION_COOKIE)?.value);

  // Expired session: send them through sign-in and straight back here.
  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const result = await acceptInvitation(token, {
    userId: viewer.userId,
    email: viewer.email,
  });
  logInvitationOutcome(result, { userId: viewer.userId });

  if (!result.ok) {
    redirect(`/invite/${token}?error=${encodeURIComponent(result.reason)}`);
  }

  // Land in the workspace they just joined. Both cookies are hints validated
  // against memberships on the next render, so a stale value cannot grant
  // anything: it would simply be ignored.
  const destination = await invitationDestination(result.organizationId);
  jar.set(ORG_COOKIE, destination.organizationId, cookieOptions());
  if (destination.projectId) jar.set(PROJECT_COOKIE, destination.projectId, cookieOptions());
  else jar.delete(PROJECT_COOKIE);

  revalidatePath("/", "layout");
  redirect(destination.projectId ? `/?project=${encodeURIComponent(destination.projectId)}` : "/");
}
