"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@calder/db";
import { isOptionalCategory, setCategoryDisabled } from "@calder/notify";
import { getTenantContext } from "../../../../lib/auth";

/**
 * Toggle one optional category for the signed-in user.
 *
 * The category is re-validated here rather than trusted from the form: a
 * crafted POST must not be able to "disable" a mandatory category, because
 * `setCategoryDisabled` refuses those and the UI would then lie about it.
 */
export async function updateEmailPreference(formData: FormData): Promise<void> {
  const ctx = await getTenantContext();
  const category = String(formData.get("category") ?? "");
  const disabled = formData.get("disabled") === "1";

  if (!isOptionalCategory(category)) {
    throw new Error("That category cannot be turned off.");
  }

  await setCategoryDisabled(getDb(), ctx.user.userId, category, disabled);
  revalidatePath("/settings/notifications");
}
