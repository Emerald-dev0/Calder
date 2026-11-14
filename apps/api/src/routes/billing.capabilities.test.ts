import { describe, it, expect, afterEach } from "vitest";
import { resetConfig } from "@calder/config";
import { resetSharedQueues } from "@calder/queue";
import { createApp } from "../app.js";

/**
 * The dashboard needs to know, before asking anyone for money, whether this
 * deployment can take any. That question is answered by a public endpoint
 * carrying two booleans — nothing about a tenant, nothing secret.
 */

const ORIGINAL = { ...process.env };

/**
 * The endpoint only asks whether the variable is non-empty, so the fixture is
 * one character. A longer, provider-shaped placeholder — however obviously
 * fake to a reader — is exactly what a secret scanner is built to match.
 */
const PRESENT = "1";

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  resetSharedQueues();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetConfig();
  resetSharedQueues();
});

const app = createApp();

describe("GET /v1/billing/capabilities", () => {
  it("is public and reports an unconfigured deployment honestly", async () => {
    setEnv({ PAYSTACK_SECRET_KEY: undefined, PAYSTACK_USD_ENABLED: undefined });
    const res = await app.request("/v1/billing/capabilities");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { capabilities: { configured: boolean; usd: boolean } };
    };
    expect(body.data.capabilities.configured).toBe(false);
    expect(body.data.capabilities.usd).toBe(false);
  });

  it("reports readiness once the secret and USD flag are present", async () => {
    setEnv({ PAYSTACK_SECRET_KEY: PRESENT, PAYSTACK_USD_ENABLED: "true" });
    const res = await app.request("/v1/billing/capabilities");
    const body = (await res.json()) as {
      data: { capabilities: { configured: boolean; usd: boolean } };
    };
    expect(body.data.capabilities).toEqual({ configured: true, usd: true });
  });

  it("does not leak the secret it is reporting on", async () => {
    setEnv({ PAYSTACK_SECRET_KEY: PRESENT });
    const res = await app.request("/v1/billing/capabilities");
    const text = await res.text();
    // The body is exactly the two booleans: no variable name, no value, no
    // configuration echo. Asserted whole rather than by absence of a fixture.
    expect(JSON.parse(text)).toEqual({
      data: { capabilities: { configured: true, usd: false } },
    });
    expect(text).not.toContain("PAYSTACK_SECRET_KEY");
  });

  it("keeps the tenant-scoped read paths authenticated", async () => {
    const summary = await app.request("/v1/billing/summary");
    expect(summary.status).toBe(401);
    const checkout = await app.request("/v1/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "credits", packId: "small", email: "a@b.co" }),
    });
    expect(checkout.status).toBe(401);
  });
});
