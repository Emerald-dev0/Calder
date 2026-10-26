/**
 * Schema ↔ migration drift check (OPS-03).
 *
 * `db:status` and `launch-check` answer "has every committed migration been
 * applied?". Neither can answer the other half: "does the committed migration
 * set actually cover the schema the code declares?" — the failure where someone
 * edits `src/schema/` and forgets to generate, or where generation silently
 * produced nothing.
 *
 * It works by running `drizzle-kit generate` against a throwaway copy of
 * `drizzle/`. If the schema is covered, generation writes nothing new. If it
 * writes a `.sql`, the committed migrations are behind the schema and the check
 * fails.
 *
 * The exit code is not trusted. drizzle-kit 0.30.6 exits 0 while printing
 * `Error: Cannot find module './enums.js'` for a broken schema path, and 0 again
 * for a malformed `out` path — the exact failure that made `pnpm db:generate`
 * dead for weeks while every CI job reading its status reported success. Output
 * is therefore classified before the file comparison.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

export type DriftOutcome =
  | { ok: true; newMigrations: []; detail: string }
  | {
      ok: false;
      kind: "error_reported" | "drizzle_failure" | "drift" | "setup";
      detail: string;
      newMigrations?: string[];
    };

/** Any mention of an `Error` in a run that exited 0. drizzle-kit is not subtle about it. */
const ERROR_TEXT = /\bError\b/;

export type DriftFailure = Extract<DriftOutcome, { ok: false }>;

/** Pure, so the exit-0-with-error trap is testable without spawning anything. */
export function classifyGenerationRun(
  stdout: string,
  stderr: string,
  exitCode: number
): DriftFailure | null {
  const out = `${stdout}\n${stderr}`;
  if (exitCode !== 0) {
    return {
      ok: false,
      kind: "drizzle_failure",
      detail: `drizzle-kit exited ${exitCode}: ${firstErrorLine(out) ?? "no output"}`,
    };
  }
  if (ERROR_TEXT.test(out)) {
    return {
      ok: false,
      kind: "error_reported",
      detail:
        `drizzle-kit reported an error and exited 0, so nothing was generated: ` +
        `${firstErrorLine(out) ?? "see output"}`,
    };
  }
  return null;
}

function firstErrorLine(out: string): string | undefined {
  return out
    .split("\n")
    .find((line) => ERROR_TEXT.test(line))
    ?.trim();
}

function sqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * `drizzle-kit`'s `exports` map publishes `.` and `./api` only, so the CLI entry
 * point cannot be resolved by subpath. Its package directory is the one thing the
 * resolvable entry does give, and `bin.cjs` always sits next to it.
 */
function drizzleKitBin(): string {
  const entry = require.resolve("drizzle-kit");
  const bin = join(dirname(entry), "bin.cjs");
  if (!existsSync(bin)) {
    throw new Error(`drizzle-kit CLI not found next to its entry point (${bin})`);
  }
  return bin;
}

/**
 * Copy `migrationsFolder`, regenerate against the copy, and report anything the
 * committed set does not already contain.
 */
export function detectSchemaDrift(input: {
  packageDir: string;
  schemaEntry: string;
  migrationsFolder: string;
  dialect?: string;
}): DriftOutcome {
  const schemaPath = resolve(input.packageDir, input.schemaEntry);
  if (!existsSync(schemaPath)) {
    return {
      ok: false,
      kind: "setup",
      detail: `${schemaPath} is missing — build @calder/db before checking drift (drizzle-kit reads the compiled schema, not src/).`,
    };
  }
  const committed = sqlFiles(input.migrationsFolder);
  if (committed.length === 0) {
    return { ok: false, kind: "setup", detail: `no .sql files in ${input.migrationsFolder}` };
  }

  // drizzle-kit prefixes `./` onto `out`, so an absolute out resolves to
  // `.//tmp/...` and the journal reads fail. The scratch copy has to live under
  // the working directory and be named relative to it.
  const work = mkdtempSync(join(input.packageDir, ".schema-drift-"));
  try {
    const scratchRel = join(relative(input.packageDir, work), "drizzle");
    const scratch = join(work, "drizzle");
    cpSync(input.migrationsFolder, scratch, { recursive: true });
    const configPath = join(work, "drizzle.config.ts");
    writeFileSync(
      configPath,
      [
        `export default {`,
        `  schema: "./${relative(input.packageDir, schemaPath)}",`,
        `  out: ${JSON.stringify(scratchRel)},`,
        `  dialect: ${JSON.stringify(input.dialect ?? "postgresql")},`,
        `  verbose: false,`,
        `  strict: true,`,
        `};`,
        "",
      ].join("\n")
    );

    const run = spawnSync(process.execPath, [drizzleKitBin(), "generate", "--config", configPath], {
      encoding: "utf8",
      cwd: input.packageDir,
      timeout: 240_000,
    });
    const failure = classifyGenerationRun(run.stdout ?? "", run.stderr ?? "", run.status ?? -1);
    if (failure) return failure;

    const produced = sqlFiles(scratch).filter((f) => !committed.includes(f));
    if (produced.length > 0) {
      return {
        ok: false,
        kind: "drift",
        newMigrations: produced,
        detail:
          `the schema declares changes that ${committed.length} committed migration(s) do not cover: ` +
          `${produced.join(", ")}. Run \`pnpm --filter @calder/db db:generate\` and commit the result.`,
      };
    }
    return {
      ok: true,
      newMigrations: [],
      detail: `schema matches ${committed.length} committed migration(s)`,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Walk up from this module to the package root, so src/ and dist/ both work. */
export function findPackageDir(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const isCli =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  const packageDir = findPackageDir(dirname(fileURLToPath(import.meta.url)));
  const result = detectSchemaDrift({
    packageDir,
    schemaEntry: "dist/schema/index.js",
    migrationsFolder: join(packageDir, "drizzle"),
  });
  if (result.ok) {
    console.log(`schema-drift: ${result.detail}`);
    process.exit(0);
  }
  console.error(`schema-drift FAILED (${result.kind}): ${result.detail}`);
  process.exit(1);
}
