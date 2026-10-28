#!/usr/bin/env node
/**
 * Fail the build when the API function was not produced.
 *
 * The tracked api/index.js lets Vercel discover the function before building,
 * but its imported bundle must also exist. An absent or truncated bundle is
 * a build failure, not something to discover on the first production request.
 * This guard checks bundle presence/size, not deployed routing or health.
 *
 * Run from the Vercel Root Directory (`apps/api`), after the bundle step:
 *   node scripts/assert-bundle.mjs
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** The bundle inlines every @calder/* package; it has never been under ~1MB. */
const MIN_BYTES = 100_000;

const target = join(process.cwd(), "dist", "serverless.js");

function fail(reason) {
  console.error("");
  console.error("================================================================");
  console.error(" BUILD FAILED: the API function was not produced.");
  console.error("================================================================");
  console.error(reason);
  console.error("");
  console.error("Without it, the tracked API entry imports a missing or invalid");
  console.error("bundle, so requests cannot reach the API handler even if");
  console.error("function discovery succeeds. Failing here instead.");
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
