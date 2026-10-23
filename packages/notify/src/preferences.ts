import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { emailPreferences, type DbClient } from "@calder/db";
import {
  COMPANY_EMAIL_CATEGORIES,
  isOptionalCategory,
  type CompanyEmailCategory,
} from "./catalogue.js";

/**
 * Who gets which category.
 *
 * The store holds what a person switched *off*, and only ever for optional
 * categories. `disableCategory` therefore refuses a mandatory one instead of
 * silently writing a row that the send path would ignore — a preference that
 * is recorded but not honoured is worse than one that is refused.
 */

export interface EmailPreferencesView {
  /** Optional categories the person has switched off. */
  disabled: string[];
  /** Every optional category, disabled or not; drives the settings UI. */
  optional: CompanyEmailCategory[];
}

export const OPTIONAL_CATEGORY_LIST: CompanyEmailCategory[] = COMPANY_EMAIL_CATEGORIES.filter((c) =>
  isOptionalCategory(c)
);

export async function getDisabledCategories(db: DbClient, userId: string): Promise<string[]> {
  const rows = await db
    .select({ disabled: emailPreferences.disabledCategories })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  const value = rows[0]?.disabled;
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
}

export async function getEmailPreferences(
  db: DbClient,
  userId: string
): Promise<EmailPreferencesView> {
  const disabled = await getDisabledCategories(db, userId);
  return {
    disabled: disabled.filter((c) => isOptionalCategory(c)),
    optional: OPTIONAL_CATEGORY_LIST,
  };
}

/**
 * True when this person has switched the category off. Mandatory categories
 * are always false, whatever the row says — including rows written by an older
 * version of the product or by hand.
 */
export async function isCategoryDisabled(
  db: DbClient,
  userId: string | null | undefined,
  category: string
): Promise<boolean> {
  if (!userId) return false;
  if (!isOptionalCategory(category)) return false;
  const disabled = await getDisabledCategories(db, userId);
  return disabled.includes(category);
}

export async function setCategoryDisabled(
  db: DbClient,
  userId: string,
  category: string,
  disabled: boolean
): Promise<{ ok: true } | { ok: false; reason: "mandatory" | "unknown_category" }> {
  if (!COMPANY_EMAIL_CATEGORIES.includes(category as CompanyEmailCategory)) {
    return { ok: false, reason: "unknown_category" };
  }
  if (!isOptionalCategory(category)) {
    return { ok: false, reason: "mandatory" };
  }

  const current = await getDisabledCategories(db, userId);
  const next = disabled
    ? Array.from(new Set([...current, category]))
    : current.filter((c) => c !== category);

  if (next.length === current.length && next.every((c, i) => c === current[i])) {
    return { ok: true };
  }

  await db
    .insert(emailPreferences)
    .values({
      id: `epref_${randomUUID()}`,
      userId,
      disabledCategories: next,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emailPreferences.userId,
      set: { disabledCategories: next, updatedAt: new Date() },
    });

  return { ok: true };
}
