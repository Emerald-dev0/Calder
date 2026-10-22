import { eq } from "drizzle-orm";
import { companyEmails, emailPreferences, type DbClient } from "@calder/db";
import type { CompanyEmailSkipReason, CompanyEmailStatus } from "./send.js";

/**
 * The persistence port for company mail.
 *
 * Exists so the send pipeline can be tested without Postgres: the interesting
 * behaviour (claiming a key, honouring an opt-out, recording a failure) is
 * logic, not SQL. The drizzle implementation is the only one used in
 * production; the in-memory one lives in the tests.
 */

export interface ClaimCompanyEmail {
  id: string;
  toEmail: string;
  userId: string | null;
  organizationId: string | null;
  template: string;
  category: string;
  subject: string;
  status: CompanyEmailStatus;
  skipReason: CompanyEmailSkipReason | null;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
}

export interface CompanyEmailRecord {
  id: string;
  status: CompanyEmailStatus;
  skipReason: string | null;
}

export interface CompanyEmailStore {
  /** Insert unless the key is taken. `null` means somebody else owns it. */
  claim(row: ClaimCompanyEmail): Promise<{ id: string } | null>;
  findByKey(idempotencyKey: string): Promise<CompanyEmailRecord | null>;
  finish(
    id: string,
    patch: {
      status: CompanyEmailStatus;
      provider?: string | null;
      providerMessageId?: string | null;
      error?: string | null;
      sentAt?: Date | null;
    }
  ): Promise<void>;
  disabledCategories(userId: string): Promise<string[]>;
}

export function drizzleCompanyEmailStore(db: DbClient): CompanyEmailStore {
  return {
    async claim(row) {
      const inserted = await db
        .insert(companyEmails)
        .values({
          id: row.id,
          toEmail: row.toEmail,
          userId: row.userId,
          organizationId: row.organizationId,
          template: row.template,
          category: row.category,
          subject: row.subject,
          status: row.status,
          skipReason: row.skipReason,
          idempotencyKey: row.idempotencyKey,
          metadata: row.metadata,
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: companyEmails.idempotencyKey })
        .returning({ id: companyEmails.id });
      return inserted[0] ?? null;
    },

    async findByKey(idempotencyKey) {
      const rows = await db
        .select({
          id: companyEmails.id,
          status: companyEmails.status,
          skipReason: companyEmails.skipReason,
        })
        .from(companyEmails)
        .where(eq(companyEmails.idempotencyKey, idempotencyKey))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, status: row.status as CompanyEmailStatus, skipReason: row.skipReason };
    },

    async finish(id, patch) {
      await db
        .update(companyEmails)
        .set({
          status: patch.status,
          provider: patch.provider ?? undefined,
          providerMessageId: patch.providerMessageId ?? undefined,
          error: patch.error ?? null,
          sentAt: patch.sentAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(companyEmails.id, id));
    },

    async disabledCategories(userId) {
      const rows = await db
        .select({ disabled: emailPreferences.disabledCategories })
        .from(emailPreferences)
        .where(eq(emailPreferences.userId, userId))
        .limit(1);
      const value = rows[0]?.disabled;
      return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
    },
  };
}
