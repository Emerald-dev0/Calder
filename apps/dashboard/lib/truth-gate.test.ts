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

// ---------------------------- M5.3 additions --------------------------------

/** Every internal route the dashboard links to must exist as a page/handler. */
function routeExists(pathname: string): boolean {
  if (pathname === "/") return existsSync(join(APP_ROOT, "app/(app)/page.tsx"));
  const seg = pathname.replace(/^\//, "").replace(/\/$/, "");
  const candidates = [
    join(APP_ROOT, "app/(app)", seg, "page.tsx"),
    join(APP_ROOT, "app/control", seg.replace(/^control\/?/, ""), "page.tsx"),
    join(APP_ROOT, "app", seg, "page.tsx"),
    join(APP_ROOT, "app/api", seg.replace(/^api\//, ""), "route.ts"),
  ];
  if (candidates.some((c) => seg && existsSync(c))) return true;
  // Dynamic segment fallback: replace concrete ids by [id]-style dirs.
  const parts = seg.split("/");
  for (const root of ["app/(app)", "app"]) {
    let dir = join(APP_ROOT, root);
    let ok = parts.length > 0 && !!parts[0];
    for (const p of parts) {
      if (!readdirSafe(dir).includes(p)) {
        ok = readdirSafe(dir).some((d) => /^\[.+\]$/.test(d));
        if (ok) {
          const dyn = readdirSafe(dir).find((d) => /^\[.+\]$/.test(d))!;
          dir = join(dir, dyn);
          continue;
        }
      } else {
        dir = join(dir, p);
      }
    }
    if (ok && existsSync(join(dir, "page.tsx"))) return true;
  }
  return false;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Extract href="/…" literals, crushing dynamic templates to their static prefix. */
function internalLinks(): Array<{ file: string; path: string }> {
  const out: Array<{ file: string; path: string }> = [];
  const re = /href=\{?["'`]\/(?!\/)([^"'`]*?)["'`]\}?/g;
  for (const { file, text } of sources()) {
    if (skip(file)) continue;
    if (!file.includes("(app)")) continue;
    for (const m of text.matchAll(re)) {
      let p = m[1]!;
      // template literal dynamics: keep static prefix
      const dyn = p.indexOf("${");
      if (dyn !== -1) p = p.slice(0, dyn);
      p = p.split(/[?#]/)[0]!;
      if (!p) continue;
      out.push({ file, path: p });
    }
  }
  return out;
}

describe("M5.3 dead-link crawl", () => {
  it("every internal href in the app shell resolves to a real route", () => {
    const missing = internalLinks().filter(({ path }) => !routeExists(path));
    expect(
      missing.map(({ file, path }) => `${file} -> /${path}`)
    ).toEqual([]);
  });
});

describe("M5.3 no fabricated numbers", () => {
  it("no thousands-formatted hardcoded metrics in dashboard views", () => {
    // "1,241 emails today" style fake dashboards. Real metrics come from SQL.
    const offenders = sources()
      .filter(({ file, text }) => {
        if (skip(file)) return false;
        if (!file.includes("(app)") && !file.includes("components/")) return false;
        return /["'`](?![^"'`]*%)\d{1,3}(?:,\d{3})+["'`]/.test(text) || />\d{1,3}(?:,\d{3})+[ ,<]/.test(text);
      })
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("no Math.random-derived UI data in app pages", () => {
    const offenders = sources()
      .filter(({ file, text }) => {
        if (skip(file)) return false;
        if (!file.includes("(app)")) return false;
        // rid()/uuid in server actions is fine; Math.random for DISPLAYED data is not.
        return /Math\.random\(\)/.test(text) && !file.includes("actions");
      })
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
