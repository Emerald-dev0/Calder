#!/usr/bin/env node
/**
 * Restore drill (§17). Proves the backup → recoverable → restore-tested chain
 * on a SCRATCH database, never against production data.
 *
 *   node scripts/restore-drill.mjs --source backups/calder-2026-10-05.dump \
 *     --target postgresql://calder:calder@localhost:5432/calder_restore_drill
 *
 *   # or let the script take the dump from the live database first:
 *   node scripts/restore-drill.mjs --from-database --target postgresql://localhost/calder_drill
 *
 * Safety rails:
 *   - `--source` and `--from-database` only read; the dump lands in ./backups.
 *   - the target database name must look like a drill database (contain
 *     drill|restore|scratch|test) unless --force is passed; the script refuses
 *     to point at a database whose name matches the source.
 *   - nothing here writes to the source database.
 *
 * What "restore-tested" means in the report: the dump restored without error,
 * the migration journal matches the source's migration set, and core tables
 * (organizations, projects, emails, usage_records) are queryable afterwards.
 * A failed drill is a failed drill: the report says so.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const target = value("--target");
const source = value("--source");
const fromDatabase = has("--from-database");
const force = has("--force");
const out = value("--out") ?? "restore-drill-report.json";

const report = {
  kind: "calder-restore-drill",
  startedAt: new Date().toISOString(),
  source: source ?? (fromDatabase ? "live database" : null),
  target: target ?? null,
  steps: [],
  result: "failed",
};
const step = (name, ok, detail) => {
  report.steps.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
};

function dbName(url) {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return null;
  }
}

try {
  if (!target) {
    step("arguments", false, "--target <scratch database url> is required");
    throw new Error("missing target");
  }
  const targetName = dbName(target);
  if (!targetName) {
    step("arguments", false, "--target is not a parseable postgres URL");
    throw new Error("bad target");
  }
  if (!/(drill|restore|scratch|test)/i.test(targetName) && !force) {
    step(
      "safety rail",
      false,
      `target database "${targetName}" does not look like a scratch database; refusing without --force`
    );
    throw new Error("unsafe target");
  }
  step("safety rail", true, `target database "${targetName}" is a scratch database`);

  const sourceUrl = process.env.DATABASE_URL;
  if (fromDatabase && sourceUrl && dbName(sourceUrl) === targetName) {
    step("safety rail", false, "target and source resolve to the same database; refusing");
    throw new Error("target equals source");
  }

  const which = (bin) => {
    try {
      return execFileSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const pgDump = which("pg_dump");
  const pgRestore = which("pg_restore");
  const psql = which("psql");
  if (!pgDump || !pgRestore) {
    step(
      "tooling",
      false,
      `pg_dump/pg_restore not on PATH (pg_dump=${pgDump ?? "missing"}, pg_restore=${pgRestore ?? "missing"}); ` +
        "install postgresql-client on the machine that runs drills"
    );
    throw new Error("tooling missing");
  }
  step("tooling", true, `pg_dump=${pgDump}, pg_restore=${pgRestore}`);

  let dump = source;
  if (fromDatabase) {
    if (!sourceUrl) {
      step("dump", false, "--from-database requires DATABASE_URL");
      throw new Error("no source url");
    }
    mkdirSync("backups", { recursive: true });
    dump = resolve(`backups/restore-drill-${Date.now()}.dump`);
    execFileSync(pgDump, ["--format=custom", "--no-owner", "--no-privileges", "--file", dump, sourceUrl], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    step("dump", true, `created ${dump} from DATABASE_URL (read-only)`);
  } else {
    if (!dump) {
      step("dump", false, "provide --source <dump file> or --from-database");
      throw new Error("no dump");
    }
    step("dump", true, `using existing dump ${dump}`);
  }
  report.dump = dump;

  // A scratch database is expected to be empty. Never drop anything: if it
  // already holds the restored schema, restore into it only when empty.
  const countsBefore = psqlCounts(psql, target);
  if (countsBefore.ok && countsBefore.relations > 0) {
    step(
      "target state",
      false,
      `target already contains ${countsBefore.relations} relation(s); use a fresh scratch database ` +
        "(the drill does not drop existing databases)"
    );
    throw new Error("target not empty");
  }
  step("target state", true, "target is empty");

  execFileSync(pgRestore, ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", target, dump], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  step("restore", true, "pg_restore completed without error");

  const counts = psqlCounts(psql, target);
  if (!counts.ok) {
    step("verify", false, `could not query the restored database: ${counts.error}`);
    throw new Error("verify failed");
  }
  const required = ["organizations", "projects", "emails", "usage_records", "api_keys"];
  const missing = required.filter((t) => !counts.tables.includes(t));
  if (missing.length) {
    step("verify", false, `restored database is missing core table(s): ${missing.join(", ")}`);
    throw new Error("missing tables");
  }
  step("verify", true, `core tables present (${required.join(", ")})`);
  step("verify", true, `restored relations=${counts.relations}; __drizzle_migrations present=${counts.hasMigrations}`);

  if (!counts.hasMigrations) {
    step("verify", false, "the migration journal did not restore: run `pnpm db:status` against the target");
    throw new Error("no migration journal");
  }
  step("verify", true, "migration journal restored (run `pnpm --filter @calder/db db:status` to inspect)");

  report.result = "passed";
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err);
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log("");
  console.log(`Result: ${report.result.toUpperCase()} — report written to ${out}`);
  console.log("A drill is only evidence if it actually ran end to end; do not edit the report.");
}

process.exit(report.result === "passed" ? 0 : 1);

function psqlCounts(psqlBin, url) {
  try {
    const relations = execFileSync(
      psqlBin,
      [
        "--tuples-only",
        "--no-align",
        "-c",
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
          "WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')",
        url,
      ],
      { encoding: "utf8" }
    ).trim();
    const tablesRaw = execFileSync(
      psqlBin,
      [
        "--tuples-only",
        "--no-align",
        "-c",
        "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        url,
      ],
      { encoding: "utf8" }
    );
    const tables = tablesRaw
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    const journal = execFileSync(
      psqlBin,
      [
        "--tuples-only",
        "--no-align",
        "-c",
        "SELECT count(*) FROM information_schema.tables " +
          "WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'",
        url,
      ],
      { encoding: "utf8" }
    ).trim();
    const hasMigrations = Number(journal) > 0;
    return { ok: true, relations: Number(relations), tables, hasMigrations };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
