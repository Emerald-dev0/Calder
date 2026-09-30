import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { DbClient } from "./client.js";

export interface JournalEntry {
  tag: string;
  when: number;
}

export interface MigrationDrift {
  /** Journal entries whose file content was never applied. Deploy must run db:migrate. */
  pending: string[];
  /**
   * Entries whose content IS applied but whose journal timestamp is newer
   * than the newest applied migration. Drizzle's migrator re-runs everything
   * newer than max(created_at) — so a regenerated timestamp re-runs an
   * applied migration and crashes on existing objects. This is exactly how
   * production lost its auth columns (0017's `when` was bumped post-apply).
   * Fix the timestamp, never edit applied migrations.
   */
  regenerated: string[];
}

/**
 * Pure diff: journal entries vs applied file-hashes vs newest applied time.
 * Hash MUST match drizzle-orm's migrator exactly: sha256 of the full SQL
 * file content (see drizzle-orm/migrator.js readMigrationFiles).
 */
export function diffMigrations(
  entries: Array<JournalEntry & { hash: string }>,
  appliedHashes: Set<string>,
  maxAppliedAt: number | null
): MigrationDrift {
  const pending: string[] = [];
  const regenerated: string[] = [];
  for (const e of entries) {
    if (!appliedHashes.has(e.hash)) {
      pending.push(e.tag);
    } else if (maxAppliedAt !== null && e.when > maxAppliedAt) {
      regenerated.push(e.tag);
    }
  }
  return { pending, regenerated };
}

export function hashMigrationFile(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function journalDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/migration-status.ts -> ../drizzle (dist/migration-status.js -> ../drizzle likewise)
  return join(here, "..", "drizzle");
}

/**
 * Live check: read this package's own journal + file hashes, compare with
 * the database's drizzle.__drizzle_migrations. Never throws for a missing
 * journal table (brand-new database = everything pending).
 */
export async function migrationStatus(
  db: DbClient
): Promise<MigrationDrift & { applied: number; total: number }> {
  const dir = journalDir();
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = journal.entries.map((e) => ({
    ...e,
    hash: hashMigrationFile(readFileSync(join(dir, `${e.tag}.sql`))),
  }));
  let appliedHashes = new Set<string>();
  let maxAppliedAt: number | null = null;
  try {
    const rows = await db.execute<{ hash: string; created_at: string }>(
      sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`
    );
    const list = Array.isArray(rows)
      ? rows
      : ((rows as unknown as { rows: typeof rows }).rows ?? []);
    for (const r of list as Array<{ hash: string; created_at: string | number | bigint }>) {
      appliedHashes.add(String(r.hash));
      const t = Number(r.created_at);
      if (Number.isFinite(t) && (maxAppliedAt === null || t > maxAppliedAt)) maxAppliedAt = t;
    }
  } catch {
    // No journal table yet: fresh database, everything pending.
  }
  const drift = diffMigrations(entries, appliedHashes, maxAppliedAt);
  return { ...drift, applied: appliedHashes.size, total: entries.length };
}
