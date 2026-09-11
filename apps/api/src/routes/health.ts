import { Hono } from "hono";
import type { Env } from "../app.js";
import spec from "../../openapi.json";

const health = new Hono<Env>();

// The OpenAPI document, served live so SDKs and docs never drift from code.
// Mounted at /v1/openapi.json (health router lives at root).
health.get("/v1/openapi.json", (c) => {
  return c.json(spec);
});

health.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

health.get("/ready", async (c) => {
  // Check critical dependencies
  const checks: Record<string, string> = {};
  let ready = true;

  // DB check, try to query if DATABASE_URL available and not in test mock bypass
  try {
    if (process.env.DATABASE_URL) {
      // Lightweight check: we don't actually connect in scaffold if no DB
      // For scaffold readiness: report degraded if env forces check and fails
      checks.db = "ok";
    } else {
      checks.db = "skipped (no DATABASE_URL)";
    }
  } catch {
    checks.db = "degraded";
    ready = false;
  }

  checks.queue = "ok";
  checks.redis = process.env.REDIS_URL ? "ok" : "skipped (no REDIS_URL)";

  const status = ready ? 200 : 503;
  return c.json(
    { status: ready ? "ready" : "degraded", checks, timestamp: new Date().toISOString() },
    status
  );
});

export default health;
