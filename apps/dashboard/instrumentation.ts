/**
 * Next.js instrumentation hook (runs once per server instance at boot).
 * M6.1/ADR-041: with REDIS_URL the rate limiter is exact across Vercel
 * instances; without it, production logs loudly that limits approximate.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configureRateLimiterFromEnv } = await import("@calder/rate-limit");
  await configureRateLimiterFromEnv();
}
