import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Truth gate (Phase 0, M0.3), CI-blocking guards against regressions of the
 * trust repairs. These scan SOURCE files, no build, no DB, runs everywhere.
 * The roadmap (M5.3) later grows these into full dead-link crawl +
 * no-fabricated-numbers gates.
 */

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".next")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      yield full;
    }
  }
}

function sources(): Array<{ file: string; text: string }> {
  return [...walk(APP_ROOT)].map((file) => ({
    file: relative(APP_ROOT, file),
    text: readFileSync(file, "utf8"),
  }));
}

const skip = (f: string) => f.includes(".test.") || f.includes("truth-gate");

describe("dashboard truth gate", () => {
  it("no in-app link points at a dashboard-relative /pricing (404)", () => {
    const offenders = sources()
      .filter(({ file, text }) => {
        if (skip(file)) return false;
        // href="/pricing" / href='/pricing' / href={"/pricing"} would 404 in this app.
        return /href=("|')\/?pricing\1/.test(text) || /href=\{("|')\/pricing\1\}/.test(text);
      })
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("the analytics page carries no fabricated preview numbers", () => {
    const offenders = sources()
      .filter(({ file, text }) => {
        if (skip(file)) return false;
        return /99\.42|48,?291|2\.1%/.test(text) && file.includes("analytics");
      })
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("dead code stays deleted: magic-link-form.tsx, dash-soon", () => {
    expect(existsSync(join(APP_ROOT, "app/login/magic-link-form.tsx"))).toBe(false);
    const offenders = sources()
      .filter(({ file, text }) => !skip(file) && text.includes("dash-soon"))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("the SMTP page does not instruct a credential flow that does not exist", () => {
    const page = join(APP_ROOT, "app/(app)/smtp/page.tsx");
    expect(existsSync(page)).toBe(true);
    const text = readFileSync(page, "utf8");
    expect(text).not.toContain("API Keys → SMTP");
    expect(text).not.toContain("smtp.calder.click");
    expect(text.toLowerCase()).toContain("not available yet");
  });
});
