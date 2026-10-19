import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { E2E_ENABLED, startApi, type ApiHandle } from "./helpers.js";

/**
 * The account journey the dashboard actually serves, driven through its real
 * HTTP route handlers against a real database:
 *
 *   signup → verification code → verify → session cookie
 *          → login → session cookie
 *          → organization + project (the onboarding writes)
 *          → API key creation (the dashboard's key path)
 *          → authenticated API interaction (real API server)
 *
 * The verification code is captured by replacing the dashboard's outbound auth
 * email with the in-memory sink below. That is the same seam a mail-capture
 * sandbox provides; nothing in the application is test-aware, and the sink
 * exists only inside this test process (no production code path is modified).
 */
const captured: Array<{ to: string; code: string; purpose: string }> = [];

vi.mock("../../dashboard/lib/send-auth-email.js", () => ({
  sendOtpEmail: async (opts: { to: string; code: string; purpose: string }) => {
    captured.push({ to: opts.to, code: opts.code, purpose: opts.purpose });
  },
}));

const gate = E2E_ENABLED ? describe : describe.skip;

const PASSWORD = "Correct-Horse-Battery-9";
const IP = "203.0.113.42";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": IP,
      "user-agent": "calder-e2e/1.0",
    },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  const match = /calder_session=([^;]+)/.exec(raw);
  return match?.[1] ?? null;
}

gate("dashboard account journey (real route handlers, real database)", () => {
  const suffix = randomBytes(4).toString("hex");
  const email = `journey-${suffix}@calder-e2e.test`;
  const orgName = `Journey Org ${suffix}`;
  let userId: string | null = null;
  let orgId: string | null = null;
  let projectId: string | null = null;
  let apiKey = "";
  let signupHandler: { POST: (req: Request) => Promise<Response> };
  let verifyHandler: { POST: (req: Request) => Promise<Response> };
  let loginHandler: { POST: (req: Request) => Promise<Response> };
  let api: ApiHandle | null = null;

  beforeAll(async () => {
    // Imported after the mock is installed.
    signupHandler = (await import("../../dashboard/app/api/auth/signup/route.js")) as never;
    verifyHandler =
      (await import("../../dashboard/app/api/auth/email-code/verify/route.js")) as never;
    loginHandler = (await import("../../dashboard/app/api/auth/login/route.js")) as never;
  }, 30_000);

  afterAll(async () => {
    if (api) await api.close();
    const { getDb, organizations, users } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    if (orgId) await getDb().delete(organizations).where(eq(organizations.id, orgId));
    if (userId) await getDb().delete(users).where(eq(users.id, userId));
  }, 30_000);

  it("signs up and issues a verification code by email", async () => {
    const res = await signupHandler.POST(
      jsonRequest("http://localhost/api/auth/signup", {
        name: "Journey Tester",
        email,
        password: PASSWORD,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; email: string };
    // Enumeration-safe: the response never says whether the account existed.
    expect(body).toEqual({ ok: true, email });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe(email);
    expect(captured[0]?.code).toMatch(/^\d{6}$/);

    const { getDb, users } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const [user] = await getDb()
      .select({ id: users.id, verified: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, email));
    expect(user?.id).toBeTruthy();
    expect(user?.verified).toBeNull();
    userId = user!.id;
  }, 30_000);

  it("rejects a disposable-domain signup (Phase 1 protection still enforced end to end)", async () => {
    const before = captured.length;
    const res = await signupHandler.POST(
      jsonRequest("http://localhost/api/auth/signup", {
        name: "Throwaway",
        email: `throwaway-${suffix}@mailinator.com`,
        password: PASSWORD,
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/isn't supported|different email/i);
    expect(captured.length).toBe(before);
  }, 30_000);

  it("verifies the code, marks the email verified and sets a session cookie", async () => {
    const code = captured[0]!.code;
    const res = await verifyHandler.POST(
      jsonRequest("http://localhost/api/auth/email-code/verify", {
        email,
        code,
        purpose: "verification",
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; redirectTo: string };
    expect(body.ok).toBe(true);
    expect(body.redirectTo).toMatch(/^\//);

    const cookie = sessionCookie(res);
    expect(cookie).toBeTruthy();
    // The session cookie is sealed, never the raw session id.
    expect(cookie!.length).toBeGreaterThan(30);

    const { getDb, users } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const [user] = await getDb()
      .select({ verified: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId!));
    expect(user?.verified).not.toBeNull();
  }, 30_000);

  it("rejects a wrong verification code and does not create a session", async () => {
    const res = await verifyHandler.POST(
      jsonRequest("http://localhost/api/auth/email-code/verify", {
        email,
        code: "000000",
        purpose: "verification",
      })
    );
    expect(res.status).toBe(400);
    expect(sessionCookie(res)).toBeNull();
  }, 30_000);

  it("logs in with the password and issues a fresh session cookie", async () => {
    const res = await loginHandler.POST(
      jsonRequest("http://localhost/api/auth/login", { email, password: PASSWORD })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; redirectTo: string };
    expect(body.ok).toBe(true);
    expect(sessionCookie(res)).toBeTruthy();
  }, 30_000);

  it("rejects a wrong password without a session (auth boundary holds)", async () => {
    const res = await loginHandler.POST(
      jsonRequest("http://localhost/api/auth/login", { email, password: "wrong-password-123" })
    );
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toBeNull();
  }, 30_000);

  it("completes onboarding: organization + project + API key, then sends over the API", async () => {
    const { getDb, organizations, organizationMembers, projects } = await import("@calder/db");
    const { generateApiKey } = await import("@calder/auth");
    const { insertApiKeyForActiveOrganization } = await import("@calder/db");
    const db = getDb();

    // Same writes the onboarding actions perform for a freshly verified user.
    orgId = `org_e2e_journey_${suffix}`;
    await db.insert(organizations).values({ id: orgId, name: orgName, slug: `journey-${suffix}` });
    await db.insert(organizationMembers).values({
      id: `orgm_e2e_journey_${suffix}`,
      organizationId: orgId,
      userId: userId!,
      role: "owner",
    });
    projectId = `proj_e2e_journey_${suffix}`;
    await db.insert(projects).values({
      id: projectId,
      organizationId: orgId,
      name: "Journey Project",
      slug: `journey-${suffix}`,
    });

    // The dashboard key path: generated once, stored hashed, shown once.
    const generated = generateApiKey("test");
    await insertApiKeyForActiveOrganization(db, projectId, {
      id: `key_e2e_journey_${suffix}`,
      projectId,
      name: "journey",
      keyPrefix: generated.prefix,
      scope: "full",
      keyHash: generated.hash,
      env: "test",
    });
    apiKey = generated.secret;

    api = await startApi();

    const res = await fetch(`${api.url}/v1/emails`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": `journey-${suffix}`,
      },
      body: JSON.stringify({
        from: `journey-${suffix}@calder-e2e.test`,
        to: `recipient-${suffix}@calder-e2e.test`,
        subject: "journey",
        text: "sent through the key created by the on boarding path",
      }),
    });
    expect(res.status).toBe(202);
    const accepted = (await res.json()) as { id: string; status: string };
    expect(accepted.status).toBe("queued");
    expect(accepted.id).toMatch(/^em_/);
    expect(apiKey.startsWith("calder_sk_test_")).toBe(true);
  }, 40_000);
});
