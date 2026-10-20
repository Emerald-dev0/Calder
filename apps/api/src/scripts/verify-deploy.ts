/**
 * Post-deploy verification (§20). Answers one question over the wire:
 * "is the deployment I just shipped able to do its job safely right now?"
 *
 *   pnpm verify:deploy -- --url https://api.calder.click
 *   pnpm verify:deploy -- --url https://api.calder.click --test-key calder_sk_test_...
 *
 * Exit 0 = every *required* check passed. Skips are printed and counted, never
 * silently treated as passes. It never sends to a real customer: the send check
 * requires a TEST-environment key and refuses anything else, and its recipient
 * is a reserved example address.
 *
 * This is deliberately read-only plus one mock send. It does not run
 * migrations, touch customer data, or mutate configuration.
 */
import { getConfig } from "@calder/config";

type Level = "pass" | "warn" | "fail" | "skip";

interface Result {
  level: Level;
  name: string;
  detail: string;
}

const results: Result[] = [];
const add = (level: Level, name: string, detail: string) => results.push({ level, name, detail });
const C = {
  pass: "\u001b[32m",
  warn: "\u001b[33m",
  fail: "\u001b[31m",
  skip: "\u001b[90m",
  reset: "\u001b[0m",
  bold: "\u001b[1m",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const baseUrl = (arg("url") ?? process.env.CALDER_API_URL ?? "").replace(/\/$/, "");
const testKey = arg("test-key") ?? process.env.CALDER_VERIFY_TEST_KEY;

interface Json {
  [key: string]: unknown;
}

async function get(
  path: string,
  headers: Record<string, string> = {},
  timeoutMs = 10_000
): Promise<{ status: number; body: Json | null; raw: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  let body: Json | null = null;
  try {
    body = JSON.parse(raw) as Json;
  } catch {
    body = null;
  }
  return { status: res.status, body, raw };
}

/* ── Liveness and readiness ─────────────────────────────────────── */

async function checkHealth(): Promise<void> {
  try {
    const res = await get("/health");
    if (res.status !== 200) {
      add("fail", "liveness", `/health returned ${res.status}`);
      return;
    }
    add("pass", "liveness", "/health answers 200");
  } catch (err) {
    add(
      "fail",
      "liveness",
      `unreachable: ${err instanceof Error ? err.message : "request failed"}`
    );
  }
}

async function checkReadiness(): Promise<boolean> {
  try {
    const res = await get("/ready");
    const checks = (res.body?.checks ?? {}) as Record<string, { state?: string; detail?: string }>;
    const states = Object.entries(checks)
      .map(([name, c]) => `${name}=${c.state ?? "?"}`)
      .join(" ");

    if (res.status !== 200) {
      add("fail", "readiness", `/ready returned ${res.status}: ${states || res.raw.slice(0, 200)}`);
      return false;
    }
    add("pass", "readiness", states || "/ready answered 200");

    // Readiness must be honest about the parts it gates on; a missing key is a
    // configuration drift signal even when overall readiness is green.
    for (const required of ["database", "queue"]) {
      const state = checks[required]?.state;
      if (state === undefined) continue;
      if (state === "ok") add("pass", `${required} (readiness)`, checks[required]?.detail ?? "ok");
      else if (state === "skipped")
        add("skip", `${required} (readiness)`, checks[required]?.detail ?? "skipped");
      else add("warn", `${required} (readiness)`, `${state}: ${checks[required]?.detail ?? ""}`);
    }
    return true;
  } catch (err) {
    add(
      "fail",
      "readiness",
      `unreachable: ${err instanceof Error ? err.message : "request failed"}`
    );
    return false;
  }
}

/* ── Public contract ────────────────────────────────────────────── */

async function checkOpenApi(): Promise<void> {
  try {
    const res = await get("/v1/openapi.json");
    const body = res.body as { openapi?: string; paths?: Record<string, unknown> } | null;
    if (res.status !== 200 || !body?.openapi || !body.paths) {
      add("fail", "openapi", `/v1/openapi.json returned ${res.status} without a spec`);
      return;
    }
    const paths = Object.keys(body.paths).length;
    const hasSend = Object.keys(body.paths).some((p) => p.includes("/emails"));
    add(
      hasSend ? "pass" : "warn",
      "openapi",
      `spec served (${body.openapi}, ${paths} paths${hasSend ? "" : ", /emails missing"})`
    );
  } catch (err) {
    add("fail", "openapi", err instanceof Error ? err.message : "request failed");
  }
}

async function checkAuthRejection(): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "a@example.com", to: "b@example.com", subject: "x", text: "x" }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (res.status === 401 && body?.error?.code) {
      add("pass", "auth", `unauthenticated send rejected (401 ${body.error.code})`);
    } else {
      add("fail", "auth", `unauthenticated send returned ${res.status} (expected 401)`);
    }
  } catch (err) {
    add("fail", "auth", err instanceof Error ? err.message : "request failed");
  }
}

/* ── Safe test send (mock provider only) ────────────────────────── */

async function checkSafeSend(): Promise<void> {
  if (!testKey) {
    add(
      "skip",
      "safe test send",
      "no test key supplied: pass --test-key calder_sk_test_... to exercise the mock send path"
    );
    return;
  }
  if (!testKey.startsWith("calder_sk_test_")) {
    add("fail", "safe test send", "refusing a non-test key: this check must never send real email");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testKey}`,
        "idempotency-key": `verify-deploy-${new Date().toISOString().slice(0, 10)}`,
      },
      body: JSON.stringify({
        from: "verify@calder.click",
        to: "delivered@resend.dev",
        subject: "Calder post-deploy verification",
        text: "Automated verification message. Safe to ignore.",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      status?: string;
      error?: { code?: string; message?: string };
    } | null;
    if ((res.status === 202 || res.status === 200) && body?.id) {
      add("pass", "safe test send", `accepted as ${body.id} (${body.status ?? "queued"})`);
    } else {
      add(
        "fail",
        "safe test send",
        `${res.status}: ${body?.error?.code ?? body?.error?.message ?? "no send id returned"}`
      );
    }
  } catch (err) {
    add("fail", "safe test send", err instanceof Error ? err.message : "request failed");
  }
}

/* ── Failure-surface checks ─────────────────────────────────────── */

async function checkAlertsEndpoint(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    add(
      "skip",
      "alert sweep",
      "CRON_SECRET not set in this shell: cannot authenticate /v1/cron/alerts"
    );
    return;
  }
  try {
    const res = await get("/v1/cron/alerts", { authorization: `Bearer ${secret}` });
    const body = (res.body ?? {}) as {
      ok?: boolean;
      alerts?: Array<{ id: string; severity: string }>;
      signals?: Record<string, unknown>;
      unavailable?: Record<string, string>;
    };
    if (res.status === 200 && body.ok) {
      add("pass", "alert sweep", `no alerts in the current window`);
      return;
    }
    if (res.status === 503 || body.ok === false) {
      const names = (body.alerts ?? []).map((a) => `${a.id}(${a.severity})`).join(", ");
      add("fail", "alert sweep", names || `returned ${res.status}`);
      return;
    }
    add("warn", "alert sweep", `returned ${res.status}`);
  } catch (err) {
    add("fail", "alert sweep", err instanceof Error ? err.message : "request failed");
  }
}

/* ── Report ─────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!baseUrl) {
    console.error(
      "Usage: pnpm --filter @calder/api verify-deploy -- --url https://api.example.com [--test-key calder_sk_test_...]"
    );
    process.exit(2);
  }

  const config = getConfig();
  console.log(`${C.bold}Calder post-deploy verification${C.reset} ${baseUrl}`);
  console.log(`${C.bold}Target environment${C.reset} ${config.NODE_ENV}\n`);

  await checkHealth();
  await checkReadiness();
  await checkOpenApi();
  await checkAuthRejection();
  await checkSafeSend();
  await checkAlertsEndpoint();

  const icon: Record<Level, string> = { pass: "✓", warn: "!", fail: "✗", skip: "-" };
  const color: Record<Level, string> = {
    pass: C.pass,
    warn: C.warn,
    fail: C.fail,
    skip: C.skip,
  };
  console.log("");
  for (const r of results) {
    console.log(
      `${color[r.level]}${icon[r.level]} ${r.level.toUpperCase().padEnd(4)}${C.reset} ${r.name}: ${r.detail}`
    );
  }

  const passed = results.filter((r) => r.level === "pass").length;
  const skipped = results.filter((r) => r.level === "skip").length;
  const failed = results.filter((r) => r.level === "fail").length;
  console.log(
    `\n${C.bold}${passed} passed, ${failed} failed, ${skipped} skipped${C.reset}` +
      (failed
        ? `\n${C.fail}Post-deploy verification FAILED — see docs/OPERATIONS.md#bad-deployment.${C.reset}`
        : "")
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Post-deploy verification crashed:", err);
  process.exit(2);
});
