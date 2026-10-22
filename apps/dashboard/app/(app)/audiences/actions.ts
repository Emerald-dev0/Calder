"use server";

import { revalidatePath } from "next/cache";
import {
  addContacts,
  archiveAudience,
  createAudience,
  importCsv,
  isMailableEmail,
} from "@calder/audiences";
import { getDb } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";

/**
 * Server actions for audiences.
 *
 * Every action resolves the project through `resolveProject`, which only
 * returns projects the signed-in user actually belongs to. A hidden form field
 * naming a project is a request, never a grant.
 */

async function requireProject(projectId: string) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, projectId);
  if (!scope) throw new Error("Project not found.");
  return { ctx, scope };
}

export async function createAudienceAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const doubleOptIn = formData.get("doubleOptIn") === "on";
  if (!name) throw new Error("Give the audience a name.");

  const { scope } = await requireProject(projectId);
  await createAudience(getDb(), {
    organizationId: scope.organization.id,
    projectId: scope.project.id,
    name,
    description: description || null,
    doubleOptIn,
  });
  revalidatePath("/audiences");
}

export async function archiveAudienceAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const audienceId = String(formData.get("audienceId") ?? "");
  const { scope } = await requireProject(projectId);
  await archiveAudience(getDb(), scope.project.id, audienceId);
  revalidatePath("/audiences");
}

export async function addContactsAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const audienceId = String(formData.get("audienceId") ?? "");
  const raw = String(formData.get("emails") ?? "");
  const consent = formData.get("consentConfirmed") === "on";
  if (!consent) {
    throw new Error("Confirm that these people gave you permission to email them.");
  }

  const emails = raw
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (emails.length === 0) throw new Error("Enter at least one email address.");
  if (emails.length > 500) throw new Error("Add at most 500 addresses at a time, or use a CSV import.");

  const { scope } = await requireProject(projectId);
  await addContacts(getDb(), {
    organizationId: scope.organization.id,
    projectId: scope.project.id,
    audienceId,
    contacts: emails.map((email) => ({ email })),
    consentSource: "manual",
  });
  revalidatePath(`/audiences/${audienceId}`);
}

export async function importCsvAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const audienceId = String(formData.get("audienceId") ?? "");
  const csv = String(formData.get("csv") ?? "");
  const consent = formData.get("consentConfirmed") === "on";
  if (!consent) {
    throw new Error("Confirm that these people gave you permission to email them.");
  }
  if (!csv.trim()) throw new Error("Paste a CSV first.");

  const { scope } = await requireProject(projectId);
  await importCsv(getDb(), {
    organizationId: scope.organization.id,
    projectId: scope.project.id,
    audienceId,
    csv,
    fileName: "pasted.csv",
    consentConfirmed: true,
  });
  revalidatePath(`/audiences/${audienceId}`);
}

/** Preview of what a paste would do, used by the confirmation copy. */
export async function previewPasteCount(raw: string): Promise<{ valid: number; invalid: number }> {
  const emails = raw
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const valid = emails.filter((email) => isMailableEmail(email)).length;
  return { valid, invalid: emails.length - valid };
}
