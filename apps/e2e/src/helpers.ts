import { randomBytes } from "node:crypto";
import { serve, type ServerType } from "@hono/node-server";
import { resetConfig } from "@calder/config";
import { resetSharedQueues } from "@calder/queue";

/**
 * E2E harness.
 *
 * These tests drive the real API (and the dashboard's real route handlers) over
 * HTTP against real Postgres and real Redis, with the real worker consuming the
 * real queue. Nothing is mocked except the outbound provider (the mock
 * provider, which is the supported test-environment mode — ADR-036) and the
 * dashboard's outbound auth email, which the account-journey test captures.
 *
 * Why a dedicated database: the drain claims rows globally by design
 * (`FOR UPDATE SKIP LOCKED`), so a concurrent suite's drain would deliver this
 * suite's "must stay queued" fixtures. E2E therefore runs against its own
 * database (`E2E_DATABASE_URL`), treated as a scratch database, and is skipped
 * with a printed reason when that is not configured — a skipped suite is never
 * reported as a pass.
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;

export const E2E_ENABLED =
  process.env.RUN_INTEGRATION_TESTS === "1" &&
  Boolean(E2E_DATABASE_URL) &&
  Boolean(process.env.REDIS_URL);

// The rest of the harness (and every workspace package it loads) reads
// DATABASE_URL; point it at the isolated E2E database exactly once, here, so no
// test can accidentally touch the shared/dev database.
if (E2E_DATABASE_URL && process.env.DATABASE_URL !== E2E_DATABASE_URL) {
  process.env.DATABASE_URL = E2E_DATABASE_URL;
}

export const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export interface E2eTenant {
  suffix: string;
  userId: string;
  orgId: string;
  projectId: string;
  keyId: string;
  /** Test-environment key: mock-only delivery, never metered (ADR-036). */
  apiKey: string;
  keyPrefix: string;
  /** Live-environment key: real delivery path + metering (mock provider here). */
  liveKeyId: string;
  liveApiKey: string;
  from: string;
}

/**
 * Provision a tenant the way onboarding does, then mint an API key through the
 * exact function the dashboard's `createKey` server action calls.
 */
export async function provisionTenant(label: string): Promise<E2eTenant> {
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    insertApiKeyForActiveOrganization,
  } = await import("@calder/db");
  const { generateApiKey } = await import("@calder/auth");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_e2e_${label}_${suffix}`;
  const projectId = `proj_e2e_${label}_${suffix}`;
  const userId = `usr_e2e_${label}_${suffix}`;
  const db = getDb();

  await db.insert(users).values({ id: userId, email: `e2e-${label}-${suffix}@test.test` });
  await db
    .insert(organizations)
    .values({ id: orgId, name: `E2E ${label}`, slug: `e2e-${label}-${suffix}` });
  await db
    .insert(organizationMembers)
    .values({ id: `orgm_${orgId}`, organizationId: orgId, userId, role: "owner" });
  await db
    .insert(projects)
    .values({ id: projectId, organizationId: orgId, name: "E2E", slug: "e2e" });

  // Test-environment key: sends go through the mock provider and are never
  // metered into billable usage (ADR-036). The suite still asserts a usage row
  // in test env, because the ledger records test-env sends with env="test".
  const generated = generateApiKey("test");
  const keyId = `key_e2e_${label}_${suffix}`;
  await insertApiKeyForActiveOrganization(db, projectId, {
    id: keyId,
    projectId,
    name: `e2e ${label}`,
    keyPrefix: generated.prefix,
    scope: "full",
    keyHash: generated.hash,
    env: "test",
  });

  // Live key for the metering assertions. In CI there are no provider
  // credentials, so this still resolves to the mock provider — the difference
  // under test is the *accounting* path (env=live), not the network.
  const live = generateApiKey("live");
  const liveKeyId = `key_e2e_live_${label}_${suffix}`;
  await insertApiKeyForActiveOrganization(db, projectId, {
    id: liveKeyId,
    projectId,
    name: `e2e ${label} live`,
    keyPrefix: live.prefix,
    scope: "full",
    keyHash: live.hash,
    env: "live",
  });

  return {
    suffix,
    userId,
    orgId,
    projectId,
    keyId,
    apiKey: generated.secret,
    keyPrefix: generated.prefix,
    liveKeyId,
    liveApiKey: live.secret,
    from: `e2e-${label}-${suffix}@test.test`,
  };
}

export async function cleanupTenant(tenant: E2eTenant): Promise<void> {
  const { getDb, cleanupSuiteOrg } = await import("@calder/db");
  await cleanupSuiteOrg(getDb(), tenant.orgId, tenant.userId);
}

/** Point the process at a specific Redis (or none) and drop cached instances. */
export function setRedisEnv(url: string | undefined): void {
  if (url === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = url;
  resetConfig();
  resetSharedQueues();
}

export interface ApiHandle {
  url: string;
  close: () => Promise<void>;
}

/** Start the real API app on a real port. */
export async function startApi(): Promise<ApiHandle> {
  const { createApp } = await import("@calder/api/src/app.js");
  const app = createApp();
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export async function post(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  { timeoutMs = 15_000, intervalMs = 100, label = "condition" } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

export async function emailRow(emailId: string) {
  const { getDb, emails } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await getDb().select().from(emails).where(eq(emails.id, emailId)).limit(1);
  return row;
}

/**
 * Metered rows for one email. The ledger id is deterministic (`ur_<emailId>`),
 * so this counts exactly the rows that ADR-036's exactly-once rule depends on.
 */
export async function usageCount(emailId: string): Promise<number> {
  const { getDb, usageRecords } = await import("@calder/db");
  const { eq, count } = await import("drizzle-orm");
  const [row] = await getDb()
    .select({ value: count() })
    .from(usageRecords)
    .where(eq(usageRecords.id, `ur_${emailId}`));
  return Number(row?.value ?? 0);
}
