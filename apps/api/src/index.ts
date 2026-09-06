import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getConfig } from "@avenor/config";
import { logger } from "@avenor/observability";

const config = getConfig();
const app = createApp();

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
