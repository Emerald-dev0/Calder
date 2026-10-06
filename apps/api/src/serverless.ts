/**
 * Serverless entry (typed source of truth — bundled before shipping).
 *
 * Vercel's function runtime executes plain Node and does not compile
 * TypeScript from symlinked workspace packages. This monorepo's `@calder/*`
 * packages export their TS sources directly (apps run them via tsx, Next.js
 * and vitest), so a raw multi-file entry crashes at boot with
 * ERR_MODULE_NOT_FOUND on e.g. `@calder/observability/src/index.ts`.
 *
 * `pnpm build` therefore runs `apps/api/scripts/bundle-serverless.mjs`, which
 * compiles this file — inlining every `@calder/*` workspace source while
 * leaving npm packages as normal external imports Vercel traces from
 * node_modules — and emits the self-contained `api/index.js` that actually
 * ships (gitignored). The long-running node server (`src/index.ts`) remains
 * for local dev and non-serverless deploys.
 *
 * Phase 2: the deployment's queue requirement is asserted at module load. On
 * Vercel (a hosted environment) a missing REDIS_URL makes the function fail
 * loudly on cold start instead of quietly accepting sends onto an in-process
 * queue that cannot survive the next invocation.
 */
import { assertQueueBootConfig, describeBoot, redisTargetLabel } from "@calder/config";
import { initErrorReporting, logger } from "@calder/observability";
import { configureRateLimiterFromEnv } from "@calder/rate-limit";
import { createApp } from "./app.js";

const redisUrl = assertQueueBootConfig("api");
await configureRateLimiterFromEnv();
const boot = describeBoot("api");
void initErrorReporting({ service: "api" });
logger.info(
  { ...boot, redisTarget: redisTargetLabel(redisUrl) },
  `API serverless function initialized (${boot.deployEnv})`
);

const app = createApp();

/**
 * Vercel Node-runtime contract (see vercel.com/docs/functions/runtimes/node-js):
 * a file under api/ must export either `{ fetch(request) }`, named HTTP-method
 * handlers, or a classic Node (req, res) handler. A bare
 * `export default (req: Request) => Response` is NOT a supported shape —
 * the runtime invokes it with Node IncomingMessage/ServerResponse and every
 * request 500s. So the Hono app is exposed through the fetch-object shape.
 */
const handler = {
  fetch(request: Request) {
    return app.fetch(request);
  },
};

export default handler;

// Drain batches (up to 25 queued emails with retries and SES throttling at
// 14/s) can outgrow the 10s default. Clamped per Vercel plan, harmless on Hobby.
export const maxDuration = 60;
