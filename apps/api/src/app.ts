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
import cron from "./routes/cron.js";

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
      // Reflect only origins we recognise. The waitlist endpoint is
      // unauthenticated, so a blanket "*" invites third-party form stuffing.
      // Server-to-server API calls never send an Origin header and are
      // unaffected by this list.
      origin: (origin) => {
        if (!origin) return "*";
        const configured = (process.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        const defaults = [
          "https://calder.click",
          "https://www.calder.click",
          "https://app.calder.click",
        ];
        const allowed = configured.length > 0 ? configured : defaults;
        if (allowed.includes(origin)) return origin;
        if (process.env.NODE_ENV !== "production") return origin;
        return allowed[0];
      },
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
  app.route("/v1/cron", cron);

  // 404
  app.notFound((c) => {
    return c.json(
      { error: { code: "not_found", message: "Route not found", request_id: c.get("requestId") } },
      404
    );
  });

  return app;
}

// Vercel's Hono preset treats src/app.* as a server entry and validates its
// default export. This default keeps that check passing for Hono detection;
// the real Vercel entry is api/index.js (see src/serverless.ts) behind the
// rewrite in vercel.json. Keeping both valid avoids "Invalid export" crashes.
export default createApp();

export type AppType = ReturnType<typeof createApp>;
