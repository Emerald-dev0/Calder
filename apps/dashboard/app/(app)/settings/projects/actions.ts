"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@calder/db";
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

/* ── Project deletion (F-08) ───────────────────────────────────────────────
 *
 * Same shape as the workspace deletion: a typed slug, checked in
 * `@calder/db` against the stored value, and a seven-day window that blocks
 * sending immediately. Refusals are redirect codes, not thrown errors.
 */

function deletionRedirect(code: string): never {
  redirect(`/settings/projects?deletion=${encodeURIComponent(code)}`);
}

export async function requestProjectDeletionAction(formData: FormData): Promise<void> {
  const ctx = await getTenantContext();
  const projectId = String(formData.get("projectId") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  const membership = ctx.memberships.find((m) => m.projects.some((p) => p.id === projectId));
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    deletionRedirect("forbidden");
  }

  const { DeletionError, requestProjectDeletion } = await import("@calder/db");
  try {
    await requestProjectDeletion(getDb(), {
      projectId,
      actorUserId: ctx.user.userId,
      confirmation,
    });
  } catch (error) {
    if (error instanceof DeletionError) deletionRedirect(error.code);
    deletionRedirect("error");
  }
  revalidatePath("/settings/projects");
  deletionRedirect("requested");
}

export async function cancelProjectDeletionAction(formData: FormData): Promise<void> {
  const ctx = await getTenantContext();
  const projectId = String(formData.get("projectId") ?? "");
  const membership = ctx.memberships.find((m) => m.projects.some((p) => p.id === projectId));
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    deletionRedirect("forbidden");
  }

  const { DeletionError, cancelProjectDeletion } = await import("@calder/db");
  try {
    await cancelProjectDeletion(getDb(), { projectId, actorUserId: ctx.user.userId });
  } catch (error) {
    if (error instanceof DeletionError) deletionRedirect(error.code);
    deletionRedirect("error");
  }
  revalidatePath("/settings/projects");
  deletionRedirect("cancelled");
}
