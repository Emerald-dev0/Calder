"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "../../../../lib/auth";
import { ORG_COOKIE, PROJECT_COOKIE } from "../../../../lib/context";
import { TransferError, transferProject } from "../../../../lib/projects/transfer";

/**
 * Move a project into another organisation.
 *
 * The action owns the whole lifecycle: validate membership on both sides, apply
 * the transfer atomically, re-point the browser's context at the destination
 * (otherwise the next page would resolve a project of the organisation you just
 * left), and land on a page that can actually render.
 *
 * Every refusal becomes a redirect with a readable reason rather than a thrown
 * error page: a limit or a permission check is a normal outcome of this form,
 * not a crash.
 */
export async function moveProjectAction(formData: FormData): Promise<void> {
  const ctx = await getTenantContext();
  const projectId = String(formData.get("projectId") ?? "");
  const destinationOrganizationId = String(formData.get("destinationOrganizationId") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  const memberships = ctx.memberships.map((m) => ({
    organizationId: m.organization.id,
    role: m.role,
  }));

  let moved: { toOrganizationId: string; projectId: string } | null = null;
  let failure: string | null = null;

  try {
    const result = await transferProject({
      viewerUserId: ctx.user.userId,
      memberships,
      projectId,
      destinationOrganizationId,
      confirmation,
    });
    moved = result;
  } catch (err) {
    if (err instanceof TransferError) {
      failure = err.message;
    } else {
      throw err;
    }
  }

  if (moved) {
    const jar = await cookies();
    const options = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    };
    jar.set(ORG_COOKIE, moved.toOrganizationId, options);
    jar.set(PROJECT_COOKIE, moved.projectId, options);
    revalidatePath("/", "layout");
    redirect(`/?project=${encodeURIComponent(projectId)}&moved=1`);
  }

  const params = new URLSearchParams({ to: destinationOrganizationId });
  if (failure) params.set("error", failure);
  redirect(`/settings/projects/${encodeURIComponent(projectId)}/move?${params.toString()}`);
}
