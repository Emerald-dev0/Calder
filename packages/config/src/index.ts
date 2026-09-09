import { z } from "zod";

/**
 * Centralized, validated environment configuration.
 * Single source of truth for env access, do NOT read process.env elsewhere.
 */
const envSchema = z.object({
 NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
 LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

 // URLs
 APP_URL: z.string().url().default("http://localhost:3000"),
 DASHBOARD_URL: z.string().url().default("http://localhost:3001"),
 API_URL: z.string().url().default("http://localhost:3002"),

 // Database
 DATABASE_URL: z.string().min(1).default("postgresql://calder:calder@localhost:5432/calder"),

 // Redis
 REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

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

 // Email Provider, optional in dev (mock provider used)
 AWS_REGION: z.string().default("us-east-1"),
 AWS_ACCESS_KEY_ID: z.string().optional(),
 AWS_SECRET_ACCESS_KEY: z.string().optional(),
 SES_FROM_DOMAIN: z.string().optional(),

 // Billing (Bachs), optional until integration validated
 BACHS_API_KEY: z.string().optional(),
 BACHS_WEBHOOK_SECRET: z.string().optional(),
 BACHS_API_URL: z.string().url().optional(),

 // Webhooks
 WEBHOOK_SIGNING_SECRET: z.string().min(8).default("whsec_dev_secret_change_me"),

 // Port overrides
 API_PORT: z.coerce.number().int().positive().default(3002),
 WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
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
