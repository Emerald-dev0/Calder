import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, MARKERS, fileViolates, violationsIn } from "./source-integrity.js";

/**
 * Source-integrity gate (repo-wide, CI-blocking).
 *
 * Rules live in ./source-integrity.ts; this file proves each one fires and
 * then runs them over every tracked source file. See that module for the
 * history of the two payload outbreaks this exists to stop.
 *
 * Every rule has a positive control: a synthetic sample that must be flagged.
 * A rule that stops detecting becomes a test failure instead of a silent gap.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

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
/** Files allowed to embed base64 (generated image assets). */
const BASE64_ALLOWED = [/apps\/api\/src\/assets\//, /\.png$|\.jpg$|\.webp$/];

/**
 * The one file exempt from scanning: this test, because building a sample that
 * trips each rule necessarily contains the pattern. Everything else — including
 * the rule module itself — is scanned.
 */
const GATE_TEST_FILE = "apps/api/src/lib/source-integrity.test.ts";

/** Directory walk, used when there is no git checkout to ask. */
function* walk(dir: string): Generator<string> {
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
    else if (SOURCE_EXT.test(entry)) yield full;
  }
}

/**
 * Tracked source files, via git when available: build outputs (.next, dist)
 * are untracked and must not be scanned — they embed whatever their inputs
 * embed and would only produce noise. Falls back to a walk outside git.
 */
function sourceFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\0")
      .filter(Boolean)
      .filter((f) => SOURCE_EXT.test(f))
      .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part)))
      .map((f) => join(REPO_ROOT, f));
  } catch {
    return [...walk(REPO_ROOT)];
  }
}

function sources(): Array<{ file: string; text: string }> {
  return sourceFiles()
    .map((file) => ({
      file: relative(REPO_ROOT, file).replace(/\\/g, "/"),
      text: readFileSync(file, "utf8"),
    }))
    .filter(({ file }) => file !== GATE_TEST_FILE)
    .filter(({ file }) => !BASE64_ALLOWED.some((re) => re.test(file)));
}

// ── Positive controls ────────────────────────────────────────────────────────
// Samples are assembled from fragments so this file never contains a
// contiguous live payload; each test proves the corresponding rule fires.
describe("detectors fire on synthetic samples", () => {
  const EVAL = ["ev", "al"].join(""); // "eval" without a literal token
  const B64 = ["at", "ob"].join("");

  it("rule 1: eval of a literal string", () => {
    expect(violationsIn(`${EVAL}("1+1")`)).toContain("eval / new Function / atob");
  });

  it("rule 2: long base64 blob", () => {
    const blob = "A".repeat(1600);
    expect(violationsIn(`const x = "${blob}";`)).toContain("long base64 blob");
  });

  it("rule 3: console monkey-patching", () => {
    expect(violationsIn(`console.log = function () {};`)).toContain("console monkey-patching");
  });

  it("rule 4: both marker families", () => {
    for (const marker of MARKERS) {
      expect(violationsIn(`global.o='${marker}';`)).toContain("known injection marker");
    }
  });

  it("rule 5: eval of an encoded string (October call shape)", () => {
    const sample = `${EVAL}("global.o='x';"+${B64}('ZG9jdW1lbnQ='))`;
    expect(violationsIn(sample)).toContain("eval of encoded string");
  });

  it("rule 5: eval of Buffer.from decoded bytes", () => {
    const sample = `${EVAL}(Buffer.from("ZG9jdW1lbnQ=", "base64").toString())`;
    expect(violationsIn(sample)).toContain("eval of encoded string");
  });

  it("rule 6: global.require rewrite", () => {
    expect(violationsIn(`global.require = require;`)).toContain("global object rewrite");
    expect(violationsIn(`globalThis.module = mod;`)).toContain("global object rewrite");
  });

  it("rule 7: abnormal whitespace padding before code", () => {
    const sample = `});${" ".repeat(2000)}${EVAL}("x")`;
    expect(violationsIn(sample)).toContain("abnormal whitespace padding");
  });

  it("rule 8: abnormally long source line", () => {
    const sample = `const a = 1;${"/* filler */".repeat(200)}`;
    expect(violationsIn(sample)).toContain("abnormally long source line");
  });

  it("every rule has at least one positive control", () => {
    const exercised = new Set([
      "eval / new Function / atob",
      "long base64 blob",
      "console monkey-patching",
      "known injection marker",
      "eval of encoded string",
      "global object rewrite",
      "abnormal whitespace padding",
      "abnormally long source line",
    ]);
    for (const rule of RULES) expect(exercised.has(rule.name)).toBe(true);
    expect(exercised.size).toBe(RULES.length);
  });
});

// ── Negative controls ────────────────────────────────────────────────────────
describe("detectors stay quiet on ordinary code", () => {
  it("normal formatting and identifiers are not flagged", () => {
    const ordinary = [
      `const total = items.reduce((a, b) => a + b, 0);`,
      `if (a === b) {`,
      `  return { evaluation: "manual", globalScope: true };`,
      `  return compute(a, b, { scoped: true }); // ordinary trailing comment`,
    ].join("\n");
    expect(violationsIn(ordinary)).toEqual([]);
  });

  it("a normal aligned comment at ordinary width passes", () => {
    const line = `const x = 1;${" ".repeat(40)}// spaced comment`;
    expect(violationsIn(line)).toEqual([]);
  });

  it("no legitimate source line approaches the long-line threshold", () => {
    const longest = Math.max(
      ...sources().map(({ text }) => Math.max(...text.split("\n").map((l) => l.length)))
    );
    expect(longest).toBeLessThan(1500);
  });

  it("this gate's own module passes its own rules", () => {
    const modulePath = join(REPO_ROOT, "apps/api/src/lib/source-integrity.ts");
    expect(violationsIn(readFileSync(modulePath, "utf8"))).toEqual([]);
  });
});

describe("source integrity gate (no obfuscated execution)", () => {
  const all = sources();

  it("scans a meaningful number of source files", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  for (const rule of RULES) {
    it(`no ${rule.name}`, () => {
      const offenders = all.filter(({ text }) => fileViolates(rule, text)).map((f) => f.file);
      expect(offenders).toEqual([]);
    });
  }
});
