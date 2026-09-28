import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source-integrity gate (repo-wide, CI-blocking).
 *
 * History: PR #38's tree shipped an obfuscated payload appended to build
 * tooling (migrate/seed/seed-demo/launch-check + both next.config.mjs files).
 * Base64 → `eval`; its first effect was to replace every `console` method with
 * a no-op, silently killing observability for anything running after module
 * load. It was removed in the Phase 7 pass; this gate makes re-introduction a
 * test failure instead of a review miss.
 *
 * Rules (source code only — assets may legitimately carry base64 image data):
 *   1. no `eval(` / `new Function(` / `atob(` anywhere in shipped code;
 *   2. no long base64 blob except under a declared asset path;
 *   3. no `console` monkey-patching (assigning to a console method).
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
 * Tracked source files, via git when available: build outputs (esbuild
 * bundles, .next, dist) are untracked and must not be scanned — they embed
 * whatever their inputs embed and would only produce noise. Falls back to a
 * directory walk outside a git checkout.
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
  return (
    sourceFiles()
      .map((file) => ({
        file: relative(REPO_ROOT, file).replace(/\\/g, "/"),
        text: readFileSync(file, "utf8"),
      }))
      // A test asserting on these patterns must be able to mention them.
      .filter(({ file }) => !file.includes("source-integrity"))
  );
}

describe("source integrity gate (no obfuscated execution)", () => {
  const all = sources();

  it("scans a meaningful number of source files", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("no eval / new Function / atob in shipped source", () => {
    const offenders = all
      .filter(({ text }) => /\beval\s*\(|new\s+Function\s*\(|\batob\s*\(/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("no long base64 blobs outside declared asset files", () => {
    const offenders = all
      .filter(({ file }) => !BASE64_ALLOWED.some((re) => re.test(file)))
      .filter(({ text }) => /[A-Za-z0-9+/]{1500,}={0,2}/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("no console monkey-patching (the injected payload's first effect)", () => {
    const offenders = all
      .filter(({ text }) => /\bconsole\s*\[[^\]]+\]\s*=|\bconsole\.\w+\s*=\s*/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("no known injection marker from PR #38", () => {
    const offenders = all
      .filter(({ text }) => text.includes("5-1517-du") || text.includes("_$_2479"))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
