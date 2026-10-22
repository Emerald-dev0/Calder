#!/usr/bin/env node
/**
 * Source-integrity gate — dependency-free CI entry point.
 *
 * Runs BEFORE `pnpm install`, so nothing in the repository has executed yet.
 * That ordering is the point: the 2026-10 payload lived in `next.config.mjs`
 * and `seed.ts`, which the toolchain runs during install, build and migrate.
 * A gate that needs `pnpm install` to run is already too late.
 *
 * It imports the rule table from `apps/api/src/lib/source-integrity.ts` via
 * Node's built-in type stripping (Node >= 22.6), so there is no build step and
 * no duplicate rule definitions. The same rules run under vitest in
 * `apps/api/src/lib/source-integrity.test.ts`, with positive controls.
 *
 *   node --experimental-strip-types scripts/source-integrity-gate.mjs
 *
 * Exit code 0 = clean. Exit code 1 = at least one violation, all printed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const rulesModule = pathToFileURL(join(REPO_ROOT, "apps/api/src/lib/source-integrity.ts")).href;
const { RULES, fileViolates, hasFolderOpenTask, fontSignatureProblem, configTailPadding } =
  await import(rulesModule);

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".venv",
  "__pycache__",
  ".cache",
]);
const BASE64_ALLOWED = [/apps\/api\/src\/assets\//, /\.png$|\.jpg$|\.webp$/];
const GATE_TEST_FILE = "apps/api/src/lib/source-integrity.test.ts";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function trackedFiles() {
  try {
    // --cached + --others: a payload dropped into the working tree but not yet
    // committed must fail too, not just one that reached a commit.
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    return [...walk(REPO_ROOT)].map((f) => relative(REPO_ROOT, f).replace(/\\/g, "/"));
  }
}

const problems = [];
const record = (file, message) => problems.push(`${file}: ${message}`);

const files = trackedFiles().filter((f) => !f.split("/").some((p) => SKIP_DIRS.has(p)));

let scannedSource = 0;
let scannedOther = 0;

const CONFIG_FILE =
  /(^|\/)(next|tailwind|postcss|eslint|vite|vitest|babel|tsup|rollup|webpack)\.config\.(js|mjs|cjs|ts|mts|cts)$|(^|\/)\.eslintrc\.(js|cjs|json|ya?ml)$|(^|\/)turbo\.json$/;

for (const file of files) {
  const abs = join(REPO_ROOT, file);
  const isSource = SOURCE_EXT.test(file);
  if (isSource) {
    if (file === GATE_TEST_FILE) continue;
    if (BASE64_ALLOWED.some((re) => re.test(file))) continue;
    const text = readFileSync(abs, "utf8");
    for (const rule of RULES) {
      if (fileViolates(rule, text)) record(file, rule.name);
    }
    // A build config is both source and a toolchain entry point: apply the
    // config-tail rule as well, since it is stricter about where the padding
    // lands and names the line.
    if (CONFIG_FILE.test(file)) {
      const problem = configTailPadding(file, text);
      if (problem) record(file, `config tail padding — ${problem}`);
    }
    scannedSource++;
    continue;
  }

  // ── non-source checks ──────────────────────────────────────────────────────
  if (/\.vscode\/tasks\.json$/.test(file)) {
    if (hasFolderOpenTask(file, readFileSync(abs, "utf8")))
      record(file, 'task auto-runs on folder open ("' + ["run", "On"].join("") + '": folderOpen)');
    scannedOther++;
    continue;
  }
  if (/\.(woff2?|ttf|otf|eot)$/i.test(file)) {
    const problem = fontSignatureProblem(file, readFileSync(abs));
    if (problem) record(file, `font signature — ${problem}`);
    scannedOther++;
    continue;
  }
  if (CONFIG_FILE.test(file)) {
    const problem = configTailPadding(file, readFileSync(abs, "utf8"));
    if (problem) record(file, `config tail padding — ${problem}`);
    scannedOther++;
  }
}

console.log(
  `source-integrity: scanned ${scannedSource} source files, ${scannedOther} non-source files, ${RULES.length} rules + 3 structural checks`
);

if (problems.length) {
  console.error(`\n${problems.length} violation(s):\n`);
  for (const p of problems) console.error("  " + p);
  console.error(
    "\nRefusing to continue. A violation here means code was appended to a file" +
      " that the toolchain executes without review."
  );
  process.exit(1);
}
console.log("source-integrity: clean");
