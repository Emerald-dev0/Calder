import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { configureRateLimiterFromEnv } from "@calder/rate-limit";
import { getConfig } from "@calder/config";
import { logger } from "@calder/observability";

const config = getConfig();

// M6.1: production w/ REDIS_URL gets exact cross-instance limits (ADR-041);
// prod WITHOUT it logs loudly (limits become per-instance approximations).
await configureRateLimiterFromEnv().then((mode) => logger.info({ limiterMode: mode }, "rate limiter configured"));
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
