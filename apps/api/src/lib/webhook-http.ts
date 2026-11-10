/**
 * Outbound webhook HTTP client with the same SSRF defenses as the legacy
 * worker consumer: the URL must be public https, DNS is resolved once and the
 * socket lookup is pinned to that vetted address (no second lookup / rebinding
 * window), and the request has a hard timeout.
 *
 * This file deliberately knows nothing about the queue or the database. The
 * caller decides what an outcome means.
 */
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isPublicIpAddress, isPublicWebhookUrl } from "@calder/validation";

export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

export type WebhookHttpResult =
  | { kind: "response"; status: number; latencyMs: number }
  | { kind: "error"; error: string; latencyMs: number };

async function resolvePublicAddress(
  url: string
): Promise<{ address: string; family: 4 | 6 } | null> {
  if (!isPublicWebhookUrl(url)) return null;
  try {
    const host = new URL(url).hostname;
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) return null;
    if (addresses.some((entry) => !isPublicIpAddress(entry.address))) return null;
    const selected = addresses[0];
    return selected && (selected.family === 4 || selected.family === 6)
      ? { address: selected.address, family: selected.family }
      : null;
  } catch {
    return null;
  }
}

/** Keep query strings and userinfo out of error text that may reach logs. */
export function redactWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = WEBHOOK_DELIVERY_TIMEOUT_MS
): Promise<WebhookHttpResult> {
  const started = Date.now();
  const address = await resolvePublicAddress(url);
  if (!address) {
    return {
      kind: "error",
      error: "endpoint_rejected_by_url_policy",
      latencyMs: Date.now() - started,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WebhookHttpResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const parsed = new URL(url);
    const req = httpsRequest(
      parsed,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "user-agent": "Calder-Webhooks/1.0",
        },
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        res.once("end", () =>
          finish({ kind: "response", status, latencyMs: Date.now() - started })
        );
      }
    );
    const timer = setTimeout(
      () => req.destroy(new Error("delivery_timeout")),
      Math.max(1_000, timeoutMs)
    );
    req.once("error", (err: Error) => {
      clearTimeout(timer);
      finish({
        kind: "error",
        // Error messages can include the host but never headers or the secret.
        error:
          err.message === "delivery_timeout" ? "delivery_timeout" : `network_error:${err.name}`,
        latencyMs: Date.now() - started,
      });
    });
    req.once("close", () => clearTimeout(timer));
    req.end(body);
  });
}
