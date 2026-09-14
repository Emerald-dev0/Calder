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
import { getConfig } from "@calder/config";
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
    const { getDb, organizations, projects, waitlistConfirmation, suppressions } =
      await import("@calder/db");
    const { eq, count } = await import("drizzle-orm");
    const db = getDb();

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
  if (process.env.REDIS_URL) {
    add("pass", "queue", "REDIS_URL set, durable retry queue");
  } else {
    add(
      "warn",
      "queue",
      "REDIS_URL unset, in-process queue only: retries do not survive a deploy and " +
        "scheduled/delayed mail is lost on restart"
    );
  }

  add(
    config.ADMIN_API_KEY ? "pass" : "warn",
    "admin access",
    config.ADMIN_API_KEY
      ? "ADMIN_API_KEY set, broadcasts and template edits available"
      : "ADMIN_API_KEY unset, /v1/admin/* disabled (no waitlist broadcasts)"
  );
  add(
    config.WEBHOOK_SIGNING_SECRET.startsWith("whsec_dev") ? "fail" : "pass",
    "webhook signing",
    config.WEBHOOK_SIGNING_SECRET.startsWith("whsec_dev")
      ? "WEBHOOK_SIGNING_SECRET is still the development default"
      : "custom signing secret set"
  );
  add(
    config.AUTH_SECRET.startsWith("dev-secret")
      ? config.NODE_ENV === "production"
        ? "fail"
        : "warn"
      : "pass",
    "auth secret",
    config.AUTH_SECRET.startsWith("dev-secret")
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
});
