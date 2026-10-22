"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, suppressions, auditLogs, projects, SUPPRESSION_REASONS } from "@calder/db";
import { assertProjectManager } from "../onboarding/actions";
import { PREVIEW_LIMIT, parseSuppressionCsv } from "../../../lib/suppressions/csv";
import { getTenantContext } from "../../../lib/auth";

/**
 * Suppression mutations.
 *
 * Every write is scoped twice: the caller must be a manager of the project
 * (assertProjectManager), and every statement carries the project id in its
 * WHERE clause so a guessed row id from another tenant cannot be touched.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Audit entry for a suppression mutation. Never throws into the mutation. */
async function audit(
  projectId: string,
  action: "suppression.added" | "suppression.removed" | "suppression.imported",
  targetId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const ctx = await getTenantContext();
    const db = getDb();
    const [project] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return;
    await db.insert(auditLogs).values({
      id: rid("audit"),
      organizationId: project.organizationId,
      actorUserId: ctx.user?.userId ?? null,
      action,
      targetType: "suppression",
      targetId,
      metadata: metadata ?? null,
    });
  } catch {
    // Auditing must never roll back the customer's action.
  }
}

export async function addSuppression(projectId: string, email: string, reason: string) {
  await assertProjectManager(projectId);
  const clean = email.trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) throw new Error("Enter a valid email address.");
  const why = (reason || "manual").trim().toLowerCase();
  if (!(SUPPRESSION_REASONS as readonly string[]).includes(why)) {
    // Manual entry is limited to the reviewed set; arbitrary text is only
    // reachable through the public API, not the dashboard.
    throw new Error(`Unknown reason "${why}".`);
  }
  const db = getDb();
  const id = rid("sup");
  await db
    .insert(suppressions)
    .values({ id, projectId, email: clean, reason: why })
    .onConflictDoNothing({ target: [suppressions.projectId, suppressions.email] });
  await audit(projectId, "suppression.added", clean, { reason: why });
  return { ok: true as const };
}

export async function removeSuppression(projectId: string, id: string) {
  await assertProjectManager(projectId);
  const db = getDb();
  const deleted = await db
    .delete(suppressions)
    .where(and(eq(suppressions.id, id), eq(suppressions.projectId, projectId)))
    .returning({ id: suppressions.id, email: suppressions.email, reason: suppressions.reason });
  if (deleted.length === 0) throw new Error("Suppression not found.");
  await audit(projectId, "suppression.removed", deleted[0]!.email, {
    reason: deleted[0]!.reason,
    suppressionId: deleted[0]!.id,
  });
  return { ok: true as const };
}

// ── CSV import ───────────────────────────────────────────────────────────────

export interface ImportRow {
  line: number;
  email: string;
  reason: string;
  status: "valid" | "invalid" | "duplicate" | "existing";
  message?: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  valid: number;
  invalid: number;
  duplicate: number;
  existing: number;
  /** True when the row list was capped for display; counts cover the whole file. */
  truncated: boolean;
}

/**
 * Classify a CSV against the database without writing anything.
 *
 * Parsing is pure (@/lib/suppressions/csv); this adds the one query the pure
 * layer cannot make — which addresses are already suppressed in this project.
 */
export async function previewSuppressionImport(
  projectId: string,
  csv: string
): Promise<ImportPreview> {
  await assertProjectManager(projectId);
  if (csv.length > 2_000_000) throw new Error("File is larger than 2 MB. Split it first.");

  const parsed = parseSuppressionCsv(csv, { limit: PREVIEW_LIMIT });

  const candidates = parsed.rows.filter((r) => r.status === "valid").map((r) => r.email);
  const existing = new Set<string>();
  if (candidates.length > 0) {
    const db = getDb();
    // Chunked to stay well under the driver's parameter limit.
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      const found = await db
        .select({ email: suppressions.email })
        .from(suppressions)
        .where(and(eq(suppressions.projectId, projectId), inArray(suppressions.email, chunk)));
      for (const f of found) existing.add(f.email.toLowerCase());
    }
  }

  const rows: ImportRow[] = parsed.rows.map((r) =>
    r.status === "valid" && existing.has(r.email)
      ? { ...r, status: "existing" as const, message: "Already suppressed in this project." }
      : r
  );

  const present = [...existing].filter((e) => candidates.includes(e)).length;
  return {
    rows,
    valid: parsed.valid - present,
    invalid: parsed.invalid,
    duplicate: parsed.duplicate,
    existing: present,
    truncated: parsed.truncated,
  };
}

export interface ImportResult {
  inserted: number;
  skippedExisting: number;
  skippedInvalid: number;
  skippedDuplicate: number;
}

/** Write the rows a preview classified as valid. Re-validates; never trusts the client. */
export async function commitSuppressionImport(
  projectId: string,
  csv: string
): Promise<ImportResult> {
  await assertProjectManager(projectId);
  const preview = await previewSuppressionImport(projectId, csv);
  const toInsert = preview.rows.filter((r) => r.status === "valid");
  if (toInsert.length === 0) {
    return {
      inserted: 0,
      skippedExisting: preview.existing,
      skippedInvalid: preview.invalid,
      skippedDuplicate: preview.duplicate,
    };
  }

  const db = getDb();
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const values = chunk.map((r) => ({
      id: rid("sup"),
      projectId,
      email: r.email,
      reason: r.reason,
    }));
    const done = await db
      .insert(suppressions)
      .values(values)
      .onConflictDoNothing({ target: [suppressions.projectId, suppressions.email] })
      .returning({ id: suppressions.id });
    inserted += done.length;
  }

  await audit(projectId, "suppression.imported", `${inserted} addresses`, {
    inserted,
    skippedExisting: preview.existing,
    skippedInvalid: preview.invalid,
    skippedDuplicate: preview.duplicate,
  });

  return {
    inserted,
    skippedExisting: preview.existing,
    skippedInvalid: preview.invalid,
    skippedDuplicate: preview.duplicate,
  };
}

/** Counts per reason for the filter tabs. Scoped to one project. */
export async function suppressionCounts(
  projectId: string
): Promise<Array<{ reason: string; count: number }>> {
  await assertProjectManager(projectId);
  const db = getDb();
  const rows = await db
    .select({ reason: suppressions.reason, count: sql<number>`count(*)::int` })
    .from(suppressions)
    .where(eq(suppressions.projectId, projectId))
    .groupBy(suppressions.reason);
  return rows.map((r) => ({ reason: r.reason, count: Number(r.count) }));
}
