import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyGenerationRun,
  detectSchemaDrift,
  findPackageDir,
  type DriftFailure,
  type DriftOutcome,
} from "./schema-drift.js";

/**
 * OPS-03: the schema must not be able to drift ahead of the committed
 * migrations. `db:status` cannot see this — every migration can be applied and
 * the schema can still contain a table no migration creates.
 *
 * The reason this file exists at all is that drizzle-kit exits 0 while printing
 * a loader error, so the checks below cover classification before plumbing.
 */

const packageDir = findPackageDir(dirname(fileURLToPath(import.meta.url)));
const migrationsFolder = join(packageDir, "drizzle");

function expectFailure(result: DriftOutcome, kind: DriftFailure["kind"]): DriftFailure {
  if (result.ok) throw new Error(`expected a "${kind}" failure, got: ${result.detail}`);
  expect(result.kind).toBe(kind);
  return result;
}

function copyMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), "calder-drift-"));
  const out = join(dir, "drizzle");
  cpSync(migrationsFolder, out, { recursive: true });
  return out;
}

function newestSnapshot(folder: string): string {
  const metas = readdirSync(join(folder, "meta"))
    .filter((f) => /^\d+_.*\.json$/.test(f))
    .sort();
  const last = metas.at(-1);
  if (!last) throw new Error("no snapshots in the copied journal");
  return join(folder, "meta", last);
}

describe("drizzle-kit exit-code trap", () => {
  it("treats a loader error that exited 0 as a failure", () => {
    const out =
      "Reading config file '/x/drizzle.config.ts'\n" +
      "Error: Cannot find module './enums.js'\n" +
      "    at Module._resolveFilename (node:internal/modules/cjs/loader:1517:15)\n";
    const verdict = classifyGenerationRun(out, "", 0);
    expect(verdict?.ok).toBe(false);
    expect(verdict?.kind).toBe("error_reported");
  });

  it("treats a failed journal read that exited 0 as a failure", () => {
    const verdict = classifyGenerationRun(
      "Reading config file '/x/drizzle.config.ts'\n",
      "Error: ENOENT: no such file or directory, open './/tmp/x/drizzle/meta/0007_snapshot.json'\n",
      0
    );
    expect(verdict?.kind).toBe("error_reported");
  });

  it("treats a clean run that exited 0 as no verdict (compare files next)", () => {
    expect(classifyGenerationRun("[✓] No schema changes, nothing to migrate", "", 0)).toBeNull();
  });

  it("treats a nonzero exit as a drizzle failure", () => {
    expect(classifyGenerationRun("", "something else", 2)?.kind).toBe("drizzle_failure");
  });
});

describe("schema drift detection (needs a built @calder/db)", () => {
  it("reports the committed migrations as covering the schema", () => {
    const result = detectSchemaDrift({
      packageDir,
      schemaEntry: "dist/schema/index.js",
      migrationsFolder,
    });
    // Not a skip: an unbuilt package is exactly the misconfiguration this tool
    // is meant to surface, so it fails loudly with the reason.
    expect(result.detail, result.ok ? "" : `setup: ${result.detail}`).toMatch(
      /matches \d+ committed migration/
    );
    expect(result.ok).toBe(true);
  }, 240_000);

  it("fails when the journal's newest snapshot does not cover the schema", () => {
    const folder = copyMigrations();
    try {
      const snapshotPath = newestSnapshot(folder);
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
        tables: Record<string, unknown>;
      };
      const tables = Object.keys(snapshot.tables);
      expect(tables.length).toBeGreaterThan(10);
      delete snapshot.tables[tables[0]!];
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

      const result = detectSchemaDrift({
        packageDir,
        schemaEntry: "dist/schema/index.js",
        migrationsFolder: folder,
      });
      const failure = expectFailure(result, "drift");
      expect(failure.newMigrations?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dirname(folder), { recursive: true, force: true });
    }
  }, 240_000);

  it("refuses to report drift when the compiled schema is missing", () => {
    const result = detectSchemaDrift({
      packageDir,
      schemaEntry: "dist/schema/does-not-exist.js",
      migrationsFolder,
    });
    expectFailure(result, "setup");
  });
});
