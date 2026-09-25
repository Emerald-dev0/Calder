import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Calder, { CalderAuthError, CalderRequestError } from "calder";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The integration a third party actually performs: install the SDK, point it
 * at the API, send, read delivery truth, retry safely, and handle failures by
 * code. This suite runs the *published* client (the `calder` workspace package,
 * i.e. the same code that ships to npm) against the real Hono app and a real
 * Postgres — no mocks on either side of the contract.
 *
 * Mocked unit tests cannot catch envelope drift (an API that wraps responses
 * in { data } while the SDK types them flat); this suite exists to catch it.
 */
gate("Node SDK against the live API (documented integration path)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, emails, suppressions } =
    await import("@calder/db");
  const { eq, count } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");
  const { drainPendingEmails } = await import("../lib/drain.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_sdk_${suffix}`;
  const projId = `proj_sdk_${suffix}`;
  const userId = `usr_sdk_${suffix}`;
  const testKey = `calder_test_sdk_${suffix}`;
  const strangerKey = `calder_test_other_${suffix}`;
  const from = `sdk-${suffix}@test.test`;

  const app = createApp();

  /** Same request path the SDK would take over the network, minus the hop. */
  const sdkFor = (apiKey: string) =>
    new Calder({
      apiKey,
      baseUrl: "http://calder.test",
      fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        return Promise.resolve(app.request(url.pathname + url.search, init));
      }) as typeof fetch,
    });

  const sdk = sdkFor(testKey);

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `sdk-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "SDK", slug: `sdk-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_${orgId}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(testKey, {
      apiKeyId: `key_sdk_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
    // A key that was never issued: the stranger's integration attempt.
    registerDevKey(strangerKey, {
      apiKeyId: `key_stranger_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("sends, drains through the mock provider, and reads delivery truth back", async () => {
    const sent = await sdk.emails.send({
      from,
      to: "first@test.test",
      subject: "Integration hello",
      text: "It works.",
    });
    expect(sent.id).toMatch(/^em_/);
    expect(sent.status).toBe("queued");

    // Test-env rows never leave the mock provider (M2.3 isolation).
    await drainPendingEmails(getDb(), { batch: 50 });

    const email = await sdk.emails.get(sent.id);
    expect(email.id).toBe(sent.id);
    expect(email.status).toBe("sent");
    expect(email.provider).toBe("mock");
    expect(email.transport).toBe("mock");
    // env is stamped from the API key, never the deployment's NODE_ENV.
    expect(email.env).toBe("test");
    expect(email.subject).toBe("Integration hello");
  });

  it("replays on the same idempotency key instead of double-sending", async () => {
    const key = `sdk-${suffix}:order-1`;
    const first = await sdk.emails.send({
      from,
      to: "same@test.test",
      subject: "Charge once",
      text: "Only one of these may exist.",
      idempotencyKey: key,
    });
    const replay = await sdk.emails.send({
      from,
      to: "same@test.test",
      subject: "Charge once",
      text: "Only one of these may exist.",
      idempotencyKey: key,
    });
    expect(replay.id).toBe(first.id);

    const [row] = await getDb()
      .select({ value: count() })
      .from(emails)
      .where(eq(emails.idempotencyKey, key));
    expect(Number(row?.value ?? 0)).toBe(1);
  });

  it("lists sends through the real { data, pagination } envelope", async () => {
    const page = await sdk.emails.list({ limit: 10 });
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.data.length).toBeGreaterThanOrEqual(2);
    expect(page.data.every((e) => typeof e.id === "string")).toBe(true);
    // Fewer rows than the limit: no further cursor.
    expect(page.nextCursor).toBeNull();
  });

  it("returns typed errors that carry the API's code", async () => {
    // Unknown key → 401, typed auth error.
    await expect(
      sdkFor(`calder_test_missing_${suffix}`).emails.send({
        from,
        to: "nope@test.test",
        subject: "x",
        text: "y",
      })
    ).rejects.toBeInstanceOf(CalderAuthError);

    // Server-side validation (client pre-flight passes) → 400 + code.
    try {
      await sdk.emails.send({ from, to: "not-an-email", subject: "x", text: "y" });
      throw new Error("expected the API to reject the recipient");
    } catch (err) {
      expect(err).toBeInstanceOf(CalderRequestError);
      const apiError = err as CalderRequestError;
      expect(apiError.status).toBe(400);
      expect(apiError.code).toBe("validation_error");
    }
  });

  it("enforces suppression and reports it as a code, not a generic failure", async () => {
    const db = getDb();
    await db.insert(suppressions).values({
      id: `sup_sdk_${suffix}`,
      projectId: projId,
      email: "blocked@test.test",
      reason: "unsubscribe",
    });

    try {
      await sdk.emails.send({
        from,
        to: "blocked@test.test",
        subject: "Must not send",
        text: "Suppressed.",
      });
      throw new Error("expected the API to refuse a suppressed recipient");
    } catch (err) {
      expect(err).toBeInstanceOf(CalderRequestError);
      const apiError = err as CalderRequestError;
      expect(apiError.status).toBe(422);
      expect(apiError.code).toBe("suppressed");
    }
  });
});
