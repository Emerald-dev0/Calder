/**
 * Vercel serverless entry point.
 *
 * Vercel functions need a request handler export; the long-running
 * `@hono/node-server` bootstrap in src/index.ts is for local/container
 * deployments. This file wraps the same Hono app (`createApp()`) with the
 * handler adapter that ships in hono core, so Vercel serves the identical
 * route set: health at `/`, everything else under `/v1/*` (rewrites in
 * vercel.json funnel every path here, including the cron drain).
 *
 * No new dependency: `hono/vercel` is part of the existing `hono` package.
 */
import { handle } from "hono/vercel";
import { createApp } from "../src/app.js";

const app = createApp();

export default handle(app);

// Drain batches (up to 25 queued emails with retries and SES throttling at
// 14/s) can outgrow the 10s default. Clamped per Vercel plan, harmless on Hobby.
export const maxDuration = 60;
