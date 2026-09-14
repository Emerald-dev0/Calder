/**
 * Serverless entry (typed source of truth — bundled before shipping).
 *
 * Vercel's function runtime executes plain Node and does not compile
 * TypeScript from symlinked workspace packages. This monorepo's `@calder/*`
 * packages export their TS sources directly (apps run them via tsx, Next.js
 * and vitest), so a raw multi-file entry crashes at boot with
 * ERR_MODULE_NOT_FOUND on e.g. `@calder/observability/src/index.ts`.
 *
 * `pnpm build` therefore runs `scripts/bundle-serverless.mjs`, which compiles
 * this file — inlining every `@calder/*` workspace source while leaving npm
 * packages as normal external imports Vercel traces from node_modules — and
 * emits the self-contained `api/index.js` that actually ships (gitignored).
 * The long-running node server (`src/index.ts`) remains for local dev and
 * non-serverless deploys.
 */
import { handle } from "hono/vercel";
import { createApp } from "./app.js";

const app = createApp();

export default handle(app);

// Drain batches (up to 25 queued emails with retries and SES throttling at
// 14/s) can outgrow the 10s default. Clamped per Vercel plan, harmless on Hobby.
export const maxDuration = 60;
