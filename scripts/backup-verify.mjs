#!/usr/bin/env node
/**
 * Backup capability verification (§16–18). No marketing trust: this reports
 * only what it can actually observe, and marks the rest as unverified.
 *
 *   node scripts/backup-verify.mjs
 *   DATABASE_URL=postgresql://... node scripts/backup-verify.mjs
 *
 * Exit 0 = nothing can be proven broken (unverified items are listed).
 * Exit 1 = something is provably missing (e.g. no database, no tooling, an
 *          unrecognised self-managed database with no backup configuration).
 *
 * It is read-only: it never writes to the database and never deletes anything.
 * A provider-side restore drill cannot be performed from here without provider
 * credentials; see docs/OPERATIONS.md § Backups for the step that does.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const url = process.env.DATABASE_URL ?? process.env.RESTORE_SOURCE_URL;
const results = [];
const add = (status, name, detail) => results.push({ status, name, detail });
const VERIFIED = "verified";
const UNVERIFIED = "unverified";
const ACTION = "owner-action";
const FAILED = "failed";

const KNOWN_PROVIDERS = [
  { match: /\.neon\.tech$/i, name: "Neon", capability: "PITR + branch restore", api: "Neon API token" },
  {
    match: /\.supabase\.(co|net)$/i,
    name: "Supabase",
    capability: "Daily backups + PITR (paid plans)",
    api: "Supabase management token",
  },
  { match: /\.railway\.app$/i, name: "Railway", capability: "Volume snapshots", api: "Railway token" },
  { match: /\.rds\.amazonaws\.com$/i, name: "AWS RDS", capability: "Automated backups + PITR", api: "AWS credentials" },
  {
    match: /\.render\.com$/i,
    name: "Render",
    capability: "Daily backups (paid plans)",
    api: "Render API key",
  },
  { match: /\.aivencloud\.com$/i, name: "Aiven", capability: "Automated backups + PITR", api: "Aiven token" },
  { match: /localhost|127\.0\.0\.1|\.local$/i, name: "Local/self-managed", capability: "whatever you configured", api: "n/a" },
];

function findBin(name) {
  try {
    const out = execFileSync("sh", ["-c", `command -v ${name} || true`], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function detectProvider(connectionUrl) {
  let host;
  try {
    host = new URL(connectionUrl).hostname;
  } catch {
    return null;
  }
  return KNOWN_PROVIDERS.find((p) => p.match.test(host)) ?? { name: "unknown", host, capability: "unknown", api: "unknown" };
}

console.log("Calder backup capability verification");
console.log(new Date().toISOString());
console.log("");

if (!url) {
  add(FAILED, "database url", "DATABASE_URL (or RESTORE_SOURCE_URL) is not set: nothing can be checked");
} else {
  add(VERIFIED, "database url", "present (credentials not printed)");
  const provider = detectProvider(url);
  if (!provider) {
    add(FAILED, "provider detection", "DATABASE_URL is not a parseable URL");
  } else if (provider.name === "unknown") {
    add(
      ACTION,
      "provider",
      `unrecognised host ${provider.host}: confirm in the provider console that automated backups + PITR ` +
        "are enabled, then record the evidence in docs/OPERATIONS.md"
    );
  } else if (provider.name === "Local/self-managed") {
    add(
      ACTION,
      "provider",
      "local/self-managed Postgres: no managed backups exist. Run `pg_dump` on a schedule (see " +
        "docs/OPERATIONS.md), and prove one restore with scripts/restore-drill.mjs"
    );
  } else {
    add(
      ACTION,
      "provider capability",
      `${provider.name} advertises: ${provider.capability}. This script cannot verify it without the ` +
        `${provider.api}. Verify in the console and paste the evidence into docs/OPERATIONS.md`
    );
  }
}

const pgDump = findBin("pg_dump");
const pgRestore = findBin("pg_restore") ?? findBin("psql");
add(
  pgDump ? VERIFIED : ACTION,
  "local tooling",
  pgDump
    ? `pg_dump found (${pgDump})${pgRestore ? `, restore tooling found (${pgRestore})` : ", pg_restore/psql NOT found"}`
    : "pg_dump not found on PATH: scripts/restore-drill.mjs cannot run from this machine. " +
      "Install postgresql-client where the drill runs"
);

// A dump script that exists but has never been executed is not a backup plan.
const drillReport = process.env.RESTORE_DRILL_REPORT ?? "restore-drill-report.json";
add(
  existsSync(drillReport) ? VERIFIED : ACTION,
  "restore drill evidence",
  existsSync(drillReport)
    ? `found ${drillReport} (from a previous drill)`
    : `no ${drillReport} in this directory: no restore has been proven here yet. Run ` +
      "`node scripts/restore-drill.mjs --source <dump>` against a scratch database and keep the report"
);

const failed = results.filter((r) => r.status === FAILED);
for (const r of results) {
  const label = r.status.toUpperCase().padEnd(11);
  console.log(`[${label}] ${r.name}: ${r.detail}`);
}

const actionCount = results.filter((r) => r.status === ACTION).length;
console.log("");
console.log(
  `${results.length - failed.length - actionCount} verified, ${actionCount} needing owner action, ${failed.length} failed`
);
console.log(
  "This check is read-only. It does not create, verify or restore a backup; see docs/OPERATIONS.md § Backups."
);
process.exit(failed.length > 0 ? 1 : 0);
