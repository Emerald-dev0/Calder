/** Wake the existing serverless consumer; never deliver inline or log credentials. */
export async function wakeDeliveryDrain(): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: "missing_url" | "missing_secret" | "request_failed" | "http_error";
      status?: number;
    }
> {
  // APP_URL is the marketing/dashboard host, not a delivery endpoint.
  const base = process.env.API_URL;
  if (!base) return { ok: false, reason: "missing_url" };
  const secret = process.env.CRON_SECRET || process.env.ADMIN_API_KEY;
  if (!secret) return { ok: false, reason: "missing_secret" };
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/cron/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-calder-kick": "1" },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    // Consume the response before releasing the host's background task.
    await response.body?.cancel();
    return response.ok
      ? { ok: true }
      : { ok: false, reason: "http_error", status: response.status };
  } catch {
    // Fetch exceptions can contain URLs/credentials. Return only a safe category.
    return { ok: false, reason: "request_failed" };
  }
}
