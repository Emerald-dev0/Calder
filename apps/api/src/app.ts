import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { errorMiddleware } from "./middleware/error.js";
import { loggerMiddleware } from "./middleware/logger.js";
import { securityHeaders } from "./middleware/security.js";
import health from "./routes/health.js";
import emails from "./routes/emails.js";
import domains from "./routes/domains.js";
import projects from "./routes/projects.js";
import webhooks from "./routes/webhooks.js";
import waitlist from "./routes/waitlist.js";
import admin from "./routes/admin.js";
import unsubscribe from "./routes/unsubscribe.js";
import senders from "./routes/senders.js";
import keys from "./routes/keys.js";
import templates from "./routes/templates.js";
import suppressions from "./routes/suppressions.js";
import batch from "./routes/batch.js";

export interface Env {
  Variables: {
    requestId: string;
    // Auth context injected by middleware
    auth?: {
      type: "api_key";
      apiKeyId: string;
      projectId: string;
      organizationId: string;
      env: "test" | "live";
    };
  };
}

export function createApp() {
  const app = new Hono<Env>();

  // Global middleware, order matters
  app.use("*", securityHeaders);
  app.use("*", requestIdMiddleware);
  app.use("*", loggerMiddleware);
  app.use(
    "*",
    cors({
      origin: (origin) => origin ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
      exposeHeaders: [
        "X-Request-Id",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ],
    })
  );
  app.onError(errorMiddleware);

  // Routes
  app.route("/", health);
  app.route("/v1/emails", emails);
  app.route("/v1/domains", domains);
  app.route("/v1/projects", projects);
  app.route("/v1/webhooks", webhooks);
  app.route("/v1/waitlist", waitlist);
  app.route("/v1/admin", admin);
  app.route("/v1/unsubscribe", unsubscribe);
  app.route("/v1/senders", senders);
  app.route("/v1/keys", keys);
  app.route("/v1/templates", templates);
  app.route("/v1/suppressions", suppressions);
  app.route("/v1/emails/batch", batch);

  // 404
  app.notFound((c) => {
    return c.json(
      { error: { code: "not_found", message: "Route not found", request_id: c.get("requestId") } },
      404
    );
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
