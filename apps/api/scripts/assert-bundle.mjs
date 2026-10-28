#!/usr/bin/env node
/**
 * Fail the build when the API function was not produced.
 *
 * Why this exists — a real outage, not a hypothetical:
 *
 * `vercel.json` sets `outputDirectory: "public"`, and Vercel treats `api/` as
 * the functions directory. When the bundle step does not run (or writes
 * somewhere else), the deployment still **succeeds**: the build completes, the
 * status turns green, and Vercel serves the static `public/` folder for every
 * path. `POST /v1/emails` then answers `200 text/html` and no mail is sent,
 * while every dashboard and status surface reports a healthy release.
 *
 * The check is one line of metadata, so it runs at the exact moment it can
 * still stop the deploy. A missing or truncated `api/index.js` becomes a build
 * error with a sentence that says what would otherwise happen silently.
 *
 * Run from the Vercel Root Directory (`apps/api`), after the bundle step:
 *   node scripts/assert-bundle.mjs
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** The bundle inlines every @calder/* package; it has never been under ~1MB. */
const MIN_BYTES = 100_000;

const target = join(process.cwd(), "api", "index.js");

function fail(reason) {
  console.error("");
  console.error("================================================================");
  console.error(" BUILD FAILED: the API function was not produced.");
  console.error("================================================================");
  console.error(reason);
  console.error("");
  console.error("Without it, this deployment would serve `public/` for every");
  console.error("path: /v1/emails answers 200 text/html, no mail is sent, and");
  console.error("the deploy still reports success. Failing here instead.");
  console.error("");
  process.exit(1);
}

if (!existsSync(target)) {
  fail(
    `Expected the bundled entry at:\n  ${target}\n\nIt is written by scripts/bundle-serverless.mjs during \`pnpm build\`.`
  );
}

const { size } = statSync(target);
if (size < MIN_BYTES) {
  fail(
    `The bundled entry is only ${size} bytes (expected at least ${MIN_BYTES}).\n` +
      `A bundle that small means the workspace packages were not inlined, so the\n` +
      `function would crash on its first request instead of serving it.`
  );
}

console.log(`bundle ok: ${target} (${Math.round(size / 1024)} KB)`);
