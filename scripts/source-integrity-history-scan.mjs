#!/usr/bin/env node
/**
 * Git-history payload scan — dependency-free.
 *
 * The working-tree gate (`source-integrity-gate.mjs`) answers "is the checkout
 * clean?". It cannot answer "did a payload ever reach a commit, and is it still
 * reachable?" — which is the question a re-injection raises, because this
 * repository has now been infected twice (2026-09-19 and 2026-10-19) and the
 * second pass only had to re-append a tail, the first cleanup having missed the
 * `createRequire` preamble.
 *
 *   node scripts/source-integrity-history-scan.mjs [ref]   # default: HEAD
 *
 * Every blob reachable from `ref` is read once from the object database and
 * tested. Blobs are deduplicated by hash, so a file that has been rewritten a
 * hundred times costs one read. Offenders are then resolved to the commits that
 * introduced them with `git log --find-object`.
 *
 * Exit 0 = no offender reachable from the ref. Exit 1 = at least one, printed
 * with the introducing commits. Historical hits are expected and are the point
 * (the payload is still in the object database); the CI job fails only if a hit
 * is reachable from a ref that is *current*, which the gate covers separately.
 * `--fail-on-any` makes history hits fatal instead, for a forensic run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = dirname(fileURLToPath(new URL(".", import.meta.url)));
const args = process.argv.slice(2);
const failOnAny = args.includes("--fail-on-any");
const ref = args.find((a) => !a.startsWith("--")) ?? "HEAD";

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_PATH = /(^|\/)(node_modules|\.git)\//;
// Same exemptions the working-tree gate uses: the detector test quotes the
// markers on purpose, and the embedded flyer asset is real base64 image data.
const ALLOWED = [
  /apps\/api\/src\/lib\/source-integrity\.(test\.)?ts$/,
  /apps\/api\/src\/assets\//,
];

/** Rule set kept deliberately small and literal: this runs in CI before install. */
const MARKERS = [
  { name: "known injection marker", test: (t) => /global\.o\s*=\s*['"][0-9-]+['"]/.test(t) },
  {
    name: "eval of decoded blob",
    test: (t) => /\beval\s*\(/.test(t) && /\batob\s*\(|Buffer\.from\([^)]*,\s*["']base64["']\s*\)/.test(t),
  },
  { name: "new Function", test: (t) => /new\s+Function\s*\(/.test(t) },
  {
    name: "commonjs require spliced into an ES module",
    test: (t) =>
      /import\s*\{\s*createRequire\s*\}\s*from\s*["']module["']/.test(t) &&
      /const\s+require\s*=\s*createRequire\(/.test(t) &&
      !/\brequire\s*\(/.test(t.replace(/const\s+require\s*=\s*createRequire\([^)]*\)/g, "")),
  },
  {
    name: "long base64 blob",
    test: (t) => t.split("\n").some((line) => /[A-Za-z0-9+/]{400,}={0,2}/.test(line)),
  },
  {
    name: "abnormally long source line",
    test: (t) => t.split("\n").some((line) => line.length > 1500),
  },
];

const git = (...a) =>
  execFileSync("git", a, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

// ── 1. enumerate blobs reachable from the ref ───────────────────────────────
const objects = new Map(); // sha -> Set<paths>
for (const line of git("rev-list", "--objects", ref).split("\n")) {
  if (!line.trim()) continue;
  const sp = line.indexOf(" ");
  if (sp < 0) continue;
  const sha = line.slice(0, sp);
  const path = line.slice(sp + 1);
  if (!path || SKIP_PATH.test(path) || !SOURCE_EXT.test(path)) continue;
  if (!objects.has(sha)) objects.set(sha, new Set());
  objects.get(sha).add(path);
}

// ── 2. read each distinct blob once ─────────────────────────────────────────
const shas = [...objects.keys()];
const offenders = [];
if (shas.length) {
  const child = spawnSync("git", ["cat-file", "--batch"], {
    cwd: REPO_ROOT,
    input: shas.join("\n") + "\n",
    maxBuffer: 1 << 30,
  });
  if (child.status !== 0) {
    console.error("git cat-file --batch failed:", child.stderr?.toString().slice(0, 400));
    process.exit(2);
  }
  const buf = child.stdout;
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    if (nl < 0) break;
    const header = buf.subarray(i, nl).toString("utf8");
    i = nl + 1;
    const parts = header.split(" ");
    if (parts.length < 3 || parts[1] !== "blob") continue;
    const sha = parts[0];
    const size = Number(parts[2]);
    const raw = buf.subarray(i, i + size);
    i += size + 1; // trailing newline
    if (raw.length !== size) break;
    const paths = [...(objects.get(sha) ?? [])];
    if (paths.some((p) => ALLOWED.some((re) => re.test(p)))) continue;
    const text = raw.toString("utf8");
    for (const rule of MARKERS) {
      if (rule.test(text)) offenders.push({ sha, paths, rule: rule.name });
    }
  }
}

console.log(
  `history-scan: ${shas.length} distinct source blobs reachable from ${ref}, ${MARKERS.length} rules`
);

if (!offenders.length) {
  console.log("history-scan: clean");
  process.exit(0);
}

// ── 3. resolve offenders to the commits that introduced them ────────────────
const unique = new Map();
for (const o of offenders) {
  const key = `${o.sha}:${o.rule}`;
  if (!unique.has(key)) unique.set(key, o);
}
console.error(`\n${unique.size} historical offender(s):\n`);
for (const o of unique.values()) {
  let introduced = [];
  try {
    introduced = git("log", "--format=%h %cs %s", "--find-object", o.sha, ref)
      .split("\n")
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    introduced = ["(unresolved)"];
  }
  console.error(`  ${o.rule}`);
  console.error(`    blob   ${o.sha.slice(0, 12)}`);
  console.error(`    paths  ${o.paths.slice(0, 6).join(", ")}${o.paths.length > 6 ? " …" : ""}`);
  for (const line of introduced) console.error(`    commit ${line}`);
  console.error("");
}
console.error(
  "Historical hits are expected: removing a file does not remove the blob. Treat this as a" +
    " forensics report — the CI blocker is `--fail-on-any`, or a hit in the working tree via" +
    " scripts/source-integrity-gate.mjs."
);
process.exit(failOnAny ? 1 : 0);
