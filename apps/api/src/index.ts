import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { configureRateLimiterFromEnv } from "@calder/rate-limit";
import {
  assertQueueBootConfig,
  describeBoot,
  getConfig,
  redisTargetLabel,
  getRedisUrl,
} from "@calder/config";
import { initErrorReporting, logger } from "@calder/observability";

const config = getConfig();

// ── Boot-time operational assertions ─────────────────────────────
// Fail loudly *now* rather than degrading silently later. In staging and
// production a missing REDIS_URL means the queue would run in-process: retries
// and delayed sends would vanish on every restart, and the worker and API
// would not even share a queue. The process refuses to start instead.
const redisUrl = assertQueueBootConfig("api");
const boot = describeBoot("api");

void initErrorReporting({ service: "api" });

// M6.1: production w/ REDIS_URL gets exact cross-instance limits (ADR-041);
// prod WITHOUT it logs loudly (limits become per-instance approximations).
await configureRateLimiterFromEnv().then((mode) =>
  logger.info({ limiterMode: mode }, "rate limiter configured")
);

logger.info(
  {
    ...boot,
    redisTarget: redisTargetLabel(redisUrl ?? getRedisUrl()),
    poolMax: process.env.DB_POOL_MAX ?? "10",
  },
  `API booted (${boot.deployEnv})`
);

const app = createApp();

// Serverless runtimes (Vercel) import this module and serve the default
// export. Only start a standalone listener when executed directly
// (`tsx watch src/index.ts`, `node dist/src/index.js`), never when imported.
const invokedAs = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedAs !== null && invokedAs === import.meta.url) {
  const port = config.API_PORT;
  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      logger.info(
        { port: info.port, env: config.NODE_ENV },
        `API listening on http://localhost:${info.port}`
      );
    }
  );
}

export default app;
