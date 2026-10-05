import { z } from "zod";

/**
 * Centralized, validated environment configuration.
 * Single source of truth for env access, do NOT read process.env elsewhere.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * Deployment environment, distinct from NODE_ENV.
   *
   * Staging runs a production build (NODE_ENV=production) on a separate
   * database/Redis pair, so NODE_ENV alone cannot tell the two apart. Set
   * CALDER_ENV=staging on the staging deployment; production sets nothing
   * (derived from NODE_ENV=production) or CALDER_ENV=production explicitly.
   *
   * Hosted environments (staging, production) require durable infrastructure:
   * Redis-backed queueing, no silent in-memory fallback. See
   * `assertQueueBootConfig` / `getRedisUrl`.
   */
  CALDER_ENV: z.enum(["development", "test", "staging", "production"]).optional(),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // URLs
  APP_URL: z.string().url().default("http://localhost:3000"),
  DASHBOARD_URL: z.string().url().default("http://localhost:3001"),
  API_URL: z.string().url().default("http://localhost:3002"),

  // Database
  DATABASE_URL: z.string().min(1).default("postgresql://calder:calder@localhost:5432/calder"),

  // Redis
  // Optional in the schema on purpose: whether it is *required* depends on the
  // deployment environment and the process. `getRedisUrl()` /
  // `assertQueueBootConfig()` enforce that; a silent default is how a
  // production deploy ends up on an in-process queue without anyone noticing.
  REDIS_URL: z.string().min(1).optional(),
  /** Connection timeout for producer-side Redis commands (fail fast, ms). */
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  /** Hard ceiling on a single enqueue call before it is treated as a failure (ms). */
  REDIS_ENQUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  // Auth
  AUTH_SECRET: z.string().min(16).default("dev-secret-change-me-32-chars-min"),
  AUTH_URL: z.string().url().default("http://localhost:3001"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Admin operations (broadcasts, manual interventions). Unset = admin routes disabled.
  ADMIN_API_KEY: z.string().min(16).optional(),
  // Founder bootstrap: comma-separated emails auto-granted owner of org_avenor on first login
  FOUNDER_EMAILS: z.string().optional(),

  // Organization-level email safety policy. New orgs get a temporary live-send
  // ceiling; recent provider feedback can automatically pause sending.
  ORG_NEW_SEND_LIMIT: z.coerce.number().int().positive().default(50),
  ORG_NEW_SEND_WINDOW_HOURS: z.coerce.number().positive().default(24),
  ORG_ABUSE_WINDOW_HOURS: z.coerce.number().positive().default(168),
  ORG_ABUSE_MINIMUM_SENDS: z.coerce.number().int().positive().default(20),
  ORG_BOUNCE_RATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.1),
  ORG_COMPLAINT_RATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.02),

  // Comma-separated additional disposable domains to reject at account creation.
  DISPOSABLE_EMAIL_DOMAINS: z.string().optional(),

  // Email Provider, optional in dev (mock provider used). In production the
  // credentials are required: @calder/providers refuses to simulate delivery.
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_FROM_DOMAIN: z.string().optional(),
  // Comma-separated SNS topic ARNs whose feedback events this deploy accepts
  // (/v1/ses/events). Unset = events from any properly-signed topic pass, but
  // subscription confirmations are never auto-approved. Set before launch.
  SES_SNS_TOPIC_ARNS: z.string().optional(),
  // Sender for Calder's own mail (verification codes, magic links, receipts).
  // SES sandbox only delivers from a verified identity, so this must be
  // settable without a deploy. Defaults to "Calder <hello@calder.click>".
  AUTH_EMAIL_FROM: z.string().optional(),

  // Billing (Bachs), optional until integration validated
  BACHS_API_KEY: z.string().optional(),
  BACHS_WEBHOOK_SECRET: z.string().optional(),
  BACHS_API_URL: z.string().url().optional(),

  // Browser origins allowed to call the public API. Server-to-server calls are
  // unaffected (no CORS involved). Defaults cover the first-party surfaces;
  // development reflects any origin so local previews work.
  ALLOWED_ORIGINS: z.string().optional(),

  // Webhooks
  WEBHOOK_SIGNING_SECRET: z.string().min(8).default("whsec_dev_secret_change_me"),

  // Port overrides
  API_PORT: z.coerce.number().int().positive().default(3002),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3003),

  // ── Error tracking (opt-in; unset = structured logs only) ────
  // Sentry-class DSN. Error reporting is a no-op without it, so local and CI
  // runs never ship anything anywhere. See docs/OPERATIONS.md § error tracking.
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  /** 0 disables performance tracing entirely (errors only). */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // ── Operational alert thresholds (all tunable without a deploy) ──
  // Queue, evaluated against Redis job counts + the durable queued rows.
  QUEUE_DEPTH_WARN: z.coerce.number().int().nonnegative().default(500),
  QUEUE_OLDEST_JOB_WARN_MINUTES: z.coerce.number().positive().default(15),
  QUEUE_DLQ_WARN: z.coerce.number().int().nonnegative().default(50),
  QUEUE_ENQUEUE_FAILURE_WARN: z.coerce.number().int().nonnegative().default(5),
  // Worker liveness: heartbeat older than this = worker not processing.
  WORKER_HEARTBEAT_STALE_SECONDS: z.coerce.number().int().positive().default(120),
  /** Exhausted jobs in the window before "repeated job failures" is raised. */
  WORKER_JOB_FAILURE_WARN: z.coerce.number().int().nonnegative().default(5),
  /** Provider send failures in the window before the provider alert is raised. */
  PROVIDER_FAILURE_WARN: z.coerce.number().int().nonnegative().default(10),
  /** Rolling window used by worker/provider counters and queue sweeps (minutes). */
  ALERT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  /** How often the worker publishes a heartbeat and evaluates in-process alerts (seconds). */
  WORKER_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  /**
   * Whether this deployment runs a long-lived worker. Serverless deploys that
   * deliver through the Postgres drain set this to false; otherwise
   * "worker not processing" would be a permanent false alarm there. When
   * false, worker-heartbeat alerts are not evaluated at all (delivery stalls
   * are still caught by the durable queued-email rule).
   */
  WORKER_EXPECTED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // API health, evaluated from in-process request metrics over the last window.
  API_ALERT_WINDOW_MINUTES: z.coerce.number().positive().default(5),
  API_5XX_WARN_PERCENT: z.coerce.number().min(0).max(100).default(5),
  API_5XX_MIN_REQUESTS: z.coerce.number().int().nonnegative().default(20),
  API_LATENCY_WARN_MS: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and validate env. Caches result.
 * In tests, call resetConfig() to re-parse.
 */
export function getConfig(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => ` - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

export function isProduction(): boolean {
  return getConfig().NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return getConfig().NODE_ENV === "development";
}

export function isTest(): boolean {
  return getConfig().NODE_ENV === "test";
}

// ── Deployment environment ───────────────────────────────────

export type DeployEnv = "development" | "test" | "staging" | "production";

/**
 * The environment this process is *deployed into*. Staging and production are
 * "hosted": they must run durable infrastructure. Derived from NODE_ENV unless
 * CALDER_ENV is set explicitly (staging needs the explicit value, since it
 * runs with NODE_ENV=production).
 */
export function getDeployEnv(): DeployEnv {
  const cfg = getConfig();
  const explicit = cfg.CALDER_ENV;
  if (!explicit) {
    if (cfg.NODE_ENV === "test") return "test";
    if (cfg.NODE_ENV === "production") return "production";
    return "development";
  }
  // Refuse contradictions instead of guessing which one to trust: a
  // production build must never silently believe it is "development".
  if (explicit === "production" && cfg.NODE_ENV !== "production") {
    throw new Error(
      `CALDER_ENV=production requires NODE_ENV=production (got NODE_ENV=${cfg.NODE_ENV}).`
    );
  }
  if (explicit === "staging" && cfg.NODE_ENV !== "production") {
    throw new Error(
      `CALDER_ENV=staging requires a production build (NODE_ENV=production, got ${cfg.NODE_ENV}).`
    );
  }
  if (explicit === "test" && cfg.NODE_ENV !== "test") {
    throw new Error(`CALDER_ENV=test requires NODE_ENV=test (got NODE_ENV=${cfg.NODE_ENV}).`);
  }
  if (explicit === "development" && cfg.NODE_ENV === "production") {
    throw new Error("CALDER_ENV=development is not allowed with NODE_ENV=production.");
  }
  return explicit;
}

/** staging + production: environments that hold real customer data. */
export function isHostedEnv(): boolean {
  const env = getDeployEnv();
  return env === "staging" || env === "production";
}

// ── Redis requirements ───────────────────────────────────────

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * The configured Redis URL, or null when unset/blank.
 * Never substitute a default here — an absent URL is a fact callers must
 * handle explicitly (allow in-memory in dev/test, refuse in staging/prod).
 */
export function getRedisUrl(): string | null {
  const url = getConfig().REDIS_URL?.trim();
  return url && url.length > 0 ? url : null;
}

/** Processes that must validate their own infrastructure requirements. */
export type ServiceName = "api" | "worker" | "dashboard" | "web" | "script";

/**
 * Redis is required for every process that enqueues or consumes durable work
 * once the deployment environment is hosted. Documented in
 * docs/OPERATIONS.md § Redis requirement matrix.
 */
export function redisRequiredFor(service: ServiceName): boolean {
  if (service === "web") return false;
  return isHostedEnv();
}

/**
 * Assert the queueing infrastructure this process needs is configured.
 *
 * Called at boot (api/worker) and by the queue factory as a second line of
 * defence. Throws `ConfigurationError` — a loud, non-recoverable boot failure
 * — rather than letting the process start with a silently degraded queue.
 */
export function assertQueueBootConfig(service: ServiceName): string | null {
  const redisUrl = getRedisUrl();
  const required = redisRequiredFor(service);
  if (required && !redisUrl) {
    throw new ConfigurationError(
      [
        `REDIS_URL is required in ${getDeployEnv()} for the ${service} process.`,
        "",
        "Why: Calder's sending path depends on a durable Redis-backed queue. Without",
        "it the queue falls back to an in-process implementation, which loses retries",
        "and delayed sends on every restart and cannot be shared between the API and",
        "the worker.",
        "",
        "Fix: set REDIS_URL (rediss:// for managed providers) on this deployment.",
        "Local development and tests may omit it; staging and production may not.",
      ].join("\n")
    );
  }
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    throw new ConfigurationError(
      `REDIS_URL must use the redis:// or rediss:// scheme (got "${redissHint(redisUrl)}").`
    );
  }
  return redisUrl;
}

/** Scheme-only preview so a misconfigured URL never leaks credentials to logs. */
function redissHint(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1];
  return scheme ? `${scheme}://…` : "invalid URL";
}

/** Boot-time summary for logs (never includes credentials). */
export interface BootSummary {
  service: ServiceName;
  deployEnv: DeployEnv;
  nodeEnv: string;
  queueDriver: "redis" | "memory";
  redisRequired: boolean;
  errorTracking: boolean;
}

export function describeBoot(service: ServiceName): BootSummary {
  const redisUrl = getRedisUrl();
  return {
    service,
    deployEnv: getDeployEnv(),
    nodeEnv: getConfig().NODE_ENV,
    queueDriver: redisUrl ? "redis" : "memory",
    redisRequired: redisRequiredFor(service),
    errorTracking: Boolean(getConfig().SENTRY_DSN),
  };
}

/**
 * Log-safe Redis target: host[:port] only, never credentials.
 * `rediss://user:pass@host:6379` → `rediss://host:6379`.
 */
export function redisTargetLabel(url: string | null): string {
  if (!url) return "unset";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "invalid";
  }
}

export * from "./plan-limits.js";
