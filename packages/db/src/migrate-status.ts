/**
 * Migration status CLI — the inspectable half of §21 (deployment safety).
 *
 *   pnpm --filter @calder/db db:status        # human-readable
 *   pnpm --filter @calder/db db:status --ci   # no colour, exits 1 on drift
 *
 * Drizzle migrations are forward-only and journal-tracked: this never writes,
 * never regenerates and never repairs. It reports the two states that have
 * actually broken production:
 *
 *   pending     — a journal entry whose file content is not applied yet
 *                 (deploy ran ahead of `db:migrate`)
 *   regenerated — an applied entry whose journal timestamp moved (drizzle
 *                 re-runs it, then crashes on existing objects; this is the
 *                 0017 auth-columns incident)
 */
import { getDb } from "./client.js";
import { migrationStatus } from "./migration-status.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required to inspect migration status");
  process.exit(2);
}

async function main(): Promise<void> {
  try {
    const status = await migrationStatus(getDb());
    const lines = [
      `applied ${status.applied}/${status.total}`,
      status.pending.length ? `pending: ${status.pending.join(", ")}` : "pending: none",
      status.regenerated.length
        ? `regenerated (journal timestamp moved after apply): ${status.regenerated.join(", ")}`
        : "regenerated: none",
    ];
    for (const line of lines) console.log(line);

    const drifted = status.pending.length > 0 || status.regenerated.length > 0;
    if (drifted) {
      console.error(
        status.pending.length
          ? "Run `pnpm db:migrate` before deploying code that depends on the pending migration."
          : "Never edit or re-timestamp an applied migration; the timestamps above must be restored."
      );
      process.exit(1);
    }
  } finally {
    // The pool is process-scoped and this CLI exits immediately; closing it
    // explicitly keeps `tsx` from hanging on the idle timer.
    const { closeDb } = await import("./client.js");
    await closeDb().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Migration status check failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
