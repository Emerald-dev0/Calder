import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The deployment contract, checked in the repo.
 *
 * Vercel reads `vercel.json` from the project's Root Directory. Both of the
 * projects that kept failing had configs that did not match what the build
 * actually produces: the API shipped a bundle at `api/index.js` with no
 * rewrite pointing at it and no declared function duration, and the root
 * project had no build command or output directory at all, so Vercel looked
 * for a `public/` folder that this repo does not have and failed the deploy
 * after a successful build.
 *
 * These assertions cannot prove a dashboard setting is right — only a deploy
 * can — but they keep the files honest about what they are supposed to do.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const API = join(REPO, "apps", "api");

type VercelConfig = {
  framework?: string | null;
  buildCommand?: string;
  installCommand?: string;
  outputDirectory?: string;
  functions?: Record<string, { maxDuration?: number }>;
  rewrites?: Array<{ source: string; destination: string }>;
  crons?: Array<{ path: string; schedule: string }>;
};

const config = (path: string): VercelConfig => JSON.parse(readFileSync(path, "utf8"));

describe("API deployment config", () => {
  const api = config(join(API, "vercel.json"));

  it("routes every path to the bundled function", () => {
    // The function is a catch-all; without this rewrite the deployment is a
    // set of files nobody can reach and every request 404s.
    expect(api.rewrites).toEqual([{ source: "/(.*)", destination: "/api/index.js" }]);
  });

  it("declares its cron jobs", () => {
    expect(api.crons?.map((c) => c.path)).toEqual(["/v1/cron/drain", "/v1/cron/company-email"]);
  });

  it("keeps a discoverable entry in the checkout", () => {
    const entry = readFileSync(join(API, "api", "index.js"), "utf8");
    expect(entry).toContain('export { default, maxDuration } from "../dist/serverless.js"');
    // Duration is still exported by the handler; no functions override needed.
    expect(api.functions).toBeUndefined();
  });

  it("has a real output directory", () => {
    // Vercel fails the deployment when the configured output directory does not
    // exist after the build, even for a functions-only project.
    expect(api.outputDirectory).toBe("public");
    expect(existsSync(join(API, "public"))).toBe(true);
  });

  it("keeps no page in the output directory", () => {
    // The friendly placeholder that used to live here masked a dead
    // deployment: with no function built, Vercel served it for every path —
    // 200, `text/html`, a green status — while nothing could send mail. A
    // missing function must read as a broken deployment, never as a page.
    expect(existsSync(join(API, "public", "index.html"))).toBe(false);
    expect(readdirSync(join(API, "public")).filter((f) => f.endsWith(".html"))).toEqual([]);
  });

  it("refuses to deploy when the function was not bundled", () => {
    // The build command ends in a guard, so a deployment that would serve only
    // static files fails the build instead of turning green.
    expect(api.buildCommand).toContain("node scripts/assert-bundle.mjs");
  });

  it("guard: fails without dist/serverless.js, passes with a real bundle", () => {
    const script = join(API, "scripts", "assert-bundle.mjs");

    // Missing bundle — the exact deployment shape that caused the outage.
    const empty = mkdtempSync(join(tmpdir(), "calder-bundle-missing-"));
    const missing = spawnSync(process.execPath, [script], { cwd: empty, encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("the API function was not produced");
    expect(missing.stderr).toContain("imports a missing or invalid");

    // Truncated bundle — workspace packages not inlined.
    const tiny = mkdtempSync(join(tmpdir(), "calder-bundle-tiny-"));
    mkdirSync(join(tiny, "dist"));
    writeFileSync(join(tiny, "dist", "serverless.js"), "export default {};");
    const short = spawnSync(process.execPath, [script], { cwd: tiny, encoding: "utf8" });
    expect(short.status).toBe(1);
    expect(short.stderr).toContain("only 18 bytes");

    // A real bundle passes and says what it found.
    const ok = mkdtempSync(join(tmpdir(), "calder-bundle-ok-"));
    mkdirSync(join(ok, "dist"));
    writeFileSync(join(ok, "dist", "serverless.js"), "x".repeat(200_000));
    const good = spawnSync(process.execPath, [script], { cwd: ok, encoding: "utf8" });
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("bundle ok");
  });

  it("is not pretending to be a framework project", () => {
    // With a framework preset, Vercel expects that framework's output and
    // fails when it is missing. The API ships functions, nothing else.
    expect(api.framework).toBeNull();
  });

  it("builds through the workspace so @calder/* packages are compiled first", () => {
    expect(api.buildCommand).toContain("@calder/api...");
    expect(api.installCommand).toBe("pnpm install --frozen-lockfile");
  });
});

describe("marketing deployment config", () => {
  const root = config(join(REPO, "vercel.json"));

  it("builds the web app and points at its output", () => {
    expect(root.buildCommand).toBe("pnpm turbo run build --filter @calder/web");
    expect(root.outputDirectory).toBe("apps/web/.next");
    expect(root.framework).toBe("nextjs");
  });

  it("keeps the output directory inside a real app", () => {
    expect(existsSync(join(REPO, "apps", "web"))).toBe(true);
    expect(existsSync(join(REPO, "apps", "web", "next.config.mjs"))).toBe(true);
  });

  it("still carries the CSP that Cloudflare's beacon needs", () => {
    const raw = readFileSync(join(REPO, "vercel.json"), "utf8");
    expect(raw).toContain("static.cloudflareinsights.com");
    expect(raw).toContain("/api/billing/webhook");
  });
});
