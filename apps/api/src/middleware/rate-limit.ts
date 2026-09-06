import type { MiddlewareHandler } from "hono";
import { getRateLimiter, rateLimitPresets } from "@avenor/rate-limit";
import { AppError } from "../errors/index.js";

export function rateLimitMiddleware(preset: keyof typeof rateLimitPresets): MiddlewareHandler {
  return async (c, next) => {
    const limiter = getRateLimiter();
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const auth = c.get("auth" as never) as
      { apiKeyId?: string; projectId?: string; organizationId?: string } | undefined;
    const key = [
      `rl:${preset}`,
      auth?.organizationId ? `org:${auth.organizationId}` : null,
      auth?.projectId ? `proj:${auth.projectId}` : null,
      auth?.apiKeyId ? `key:${auth.apiKeyId}` : null,
      `ip:${ip}`,
    ]
      .filter(Boolean)
      .join(":");

    const opts = rateLimitPresets[preset];
    const result = await limiter.check(key, opts);

    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt.getTime() / 1000)));

    if (!result.allowed) {
      const retryAfter = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : 60;
      c.header("Retry-After", String(retryAfter));
      throw new AppError("rate_limit_error", "Rate limit exceeded. Please retry later.", 429);
    }

    await next();
  };
}
