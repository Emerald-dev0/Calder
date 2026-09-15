import { Hono } from "hono";
import { getDb, analyticsEvents } from "@calder/db";
import { beaconBatchSchema } from "@calder/validation";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import type { Env } from "../app.js";

const beacon = new Hono<Env>();

function newId(): string {
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Country from the edge geo header. Server-derived only; never from the client (REQ-080/084). */
function edgeCountry(getHeader: (name: string) => string | undefined): string | null {
  const c = getHeader("x-vercel-ip-country");
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}

/**
 * POST /v1/beacon — first-party analytics ingestion (REQ-081).
 *
 * Public (anonymous ids only, no PII by schema construction), rate-limited,
 * zod-validated with unknown fields stripped (.strict() schemas reject
 * unknown keys; extra top-level fields fail validation). Batch ≤ 20.
 * Always 204 on success — the beacon must never surface errors to browsers.
 */
beacon.post("/", rateLimitMiddleware("beacon"), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    // Malformed JSON: shed silently. This endpoint is telemetry, not a contract.
    return c.body(null, 204);
  }

  const parsed = beaconBatchSchema.safeParse(body);
  if (!parsed.success) return c.body(null, 204);

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    // DB unavailable: drop silently rather than erroring page UX (NFR-009 logs server-side).
    return c.body(null, 204);
  }

  const country = edgeCountry((name) => c.req.header(name));
  const rows = parsed.data.events.map((e) => ({
    id: newId(),
    type: e.type,
    path: e.path ?? null,
    label: e.label ?? null,
    referrer: e.referrer ?? null,
    source: e.source ?? null,
    utm: e.utm ?? null,
    sessionId: e.sessionId,
    visitorId: e.visitorId,
    device: e.device ?? null,
    country,
    createdAt: new Date(),
  }));

  try {
    await db.insert(analyticsEvents).values(rows);
  } catch (err) {
    // Diagnosable server-side, silent client-side (NFR-009).
    console.error("[beacon] insert failed", err instanceof Error ? err.message : err);
  }
  return c.body(null, 204);
});

export default beacon;
