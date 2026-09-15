import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { getConfig } from "@calder/config";
import { logger } from "@calder/observability";

const config = getConfig();
const app = createApp();

// Vercel's Hono runtime imports this module and serves the default export.
// Only start a standalone listener when executed directly
// (`tsx watch src/index.ts`, `node dist/index.js`), never when imported.
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
