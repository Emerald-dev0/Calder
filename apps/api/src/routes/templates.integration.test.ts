import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Templates are explicitly part of the MVP, so the acceptance criteria are the
 * customer journey, not "CRUD returns 200":
 *
 *   1. create a template           2. find it again (list + detail)
 *   3. edit it (new immutable version)
 *   4. send through the email API with variables
 *   5. see the resulting delivery record / event
 *   6. delete it without destroying history
 *
 * Plus the two ways this can go quietly wrong: a template that belongs to
 * another project must be invisible, and a missing variable must fail loudly
 * instead of sending `{{name}}` to a customer.
 */
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

gate("template journey through the real API (live Postgres)", () => {
  const suffix = randomBytes(4).toString("hex");
  const orgA = `org_tpl_a_${suffix}`;
  const orgB = `org_tpl_b_${suffix}`;
  const projectA = `proj_tpl_a_${suffix}`;
  const projectB = `proj_tpl_b_${suffix}`;
  const userA = `usr_tpl_a_${suffix}`;
  const userB = `usr_tpl_b_${suffix}`;
  const keyA = `calder_live_tpl_a_${suffix}`;
  const keyB = `calder_live_tpl_b_${suffix}`;
  const senderA = `sender_tpl_a_${suffix}`;
  const senderAddress = `mail-${suffix}@tpl-a.test`;

  let app: ReturnType<typeof import("../app.js").createApp>;
  let templateId = "";
  let sentEmailId = "";

  const call = (path: string, init: RequestInit = {}, key = keyA) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...(init.headers ?? {}),
      },
    });

  const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const {
      getDb,
      organizations,
      organizationMembers,
      projects,
      users,
      senderIdentities,
    } = await import("@calder/db");
    const { createApp } = await import("../app.js");
    const { registerDevKey } = await import("../middleware/auth.js");
    const db = getDb();
    app = createApp();

    await db.insert(users).values([
      { id: userA, email: `tpl-a-${suffix}@test.test` },
      { id: userB, email: `tpl-b-${suffix}@test.test` },
    ]);
    await db.insert(organizations).values([
      { id: orgA, name: "Templates A", slug: `tpl-a-${suffix}` },
      { id: orgB, name: "Templates B", slug: `tpl-b-${suffix}` },
    ]);
    await db.insert(organizationMembers).values([
      { id: `orgm_tpl_a_${suffix}`, organizationId: orgA, userId: userA, role: "owner" },
      { id: `orgm_tpl_b_${suffix}`, organizationId: orgB, userId: userB, role: "owner" },
    ]);
    await db.insert(projects).values([
      { id: projectA, organizationId: orgA, name: "A", slug: "a" },
      { id: projectB, organizationId: orgB, name: "B", slug: "b" },
    ]);
    await db.insert(senderIdentities).values({
      id: senderA,
      projectId: projectA,
      displayName: "Templates A",
      email: senderAddress,
      type: "domain",
      status: "verified",
      isDefault: true,
    });

    registerDevKey(keyA, {
      apiKeyId: `key_tpl_a_${suffix}`,
      projectId: projectA,
      organizationId: orgA,
      env: "live",
    });
    registerDevKey(keyB, {
      apiKeyId: `key_tpl_b_${suffix}`,
      projectId: projectB,
      organizationId: orgB,
      env: "live",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const { getDb, cleanupSuiteOrg } = await import("@calder/db");
    const db = getDb();
    await cleanupSuiteOrg(db, orgA, userA);
    await cleanupSuiteOrg(db, orgB, userB);
  });

  it("creates a template with content and variables", async () => {
    if (!(await reachable())) return;
    const res = await call("/v1/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Welcome email",
        alias: `welcome-${suffix}`,
        description: "First sign-in",
        subject: "Welcome, {{name}}",
        html: "<p>Hi {{name}}, your code is {{code}}</p>",
        text: "Hi {{name}}, your code is {{code}}",
      }),
    });
    expect(res.status).toBe(201);
    const body = await json<{ data: { id: string; alias: string; latest_version: { version: string } } }>(
      res
    );
    templateId = body.data.id;
    expect(body.data.id.startsWith("tpl_")).toBe(true);
    expect(body.data.alias).toBe(`welcome-${suffix}`);
    expect(body.data.latest_version.version).toBe("v1");

    // Duplicate aliases on the same project are a conflict, not a silent second row.
    const dup = await call("/v1/templates", {
      method: "POST",
      body: JSON.stringify({ name: "Another", alias: `welcome-${suffix}` }),
    });
    expect(dup.status).toBe(409);
  });

  it("finds it again by list and by id", async () => {
    if (!(await reachable())) return;
    const list = await call(`/v1/templates?limit=10`);
    expect(list.status).toBe(200);
    const listed = await json<{ data: Array<{ id: string; name: string }> }>(list);
    expect(listed.data.some((t) => t.id === templateId)).toBe(true);

    const detail = await call(`/v1/templates/${templateId}`);
    expect(detail.status).toBe(200);
    const one = await json<{ data: { name: string } }>(detail);
    expect(one.data.name).toBe("Welcome email");
  });

  it("edits by appending an immutable version", async () => {
    if (!(await reachable())) return;
    const res = await call(`/v1/templates/${templateId}/versions`, {
      method: "POST",
      body: JSON.stringify({
        subject: "Welcome aboard, {{name}}",
        html: "<p>Hello {{name}}, code {{code}}</p>",
        text: "Hello {{name}}, code {{code}}",
      }),
    });
    expect(res.status).toBe(201);
    const body = await json<{ data: { version: string } }>(res);
    expect(body.data.version).toBe("v2");

    const versions = await call(`/v1/templates/${templateId}/versions`);
    const history = await json<{ data: Array<{ version: string }> }>(versions);
    expect(history.data.map((v) => v.version)).toEqual(["v2", "v1"]);

    const detail = await call(`/v1/templates/${templateId}`);
    const one = await json<{ data: { latest_version: { version: string; subject: string } } }>(detail);
    expect(one.data.latest_version.version).toBe("v2");
    expect(one.data.latest_version.subject).toBe("Welcome aboard, {{name}}");
  });

  it("sends through /v1/emails with variables rendered before the provider", async () => {
    if (!(await reachable())) return;
    const { getDb, emails, emailEvents } = await import("@calder/db");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();

    const idem = `tpl-send-${suffix}`;
    const send = await call("/v1/emails", {
      method: "POST",
      headers: { "idempotency-key": idem },
      body: JSON.stringify({
        from: senderA,
        to: "ada@example.test",
        template: `welcome-${suffix}`,
        variables: { name: "Ada", code: "482915" },
      }),
    });
    expect(send.status).toBe(202);
    const accepted = await json<{ id: string; status: string }>(send);
    sentEmailId = accepted.id;
    expect(accepted.status).toBe("queued");

    const [row] = await db.select().from(emails).where(eq(emails.id, sentEmailId)).limit(1);
    expect(row).toBeDefined();
    // Rendered at ingest: the provider never receives a placeholder.
    expect(row!.subject).toBe("Welcome aboard, Ada");
    expect(row!.html).toBe("<p>Hello Ada, code 482915</p>");
    expect(row!.text).toBe("Hello Ada, code 482915");
    expect(row!.from).toBe(senderAddress);

    // The delivery record is visible: a queued lifecycle event exists.
    const queued = await db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, sentEmailId), eq(emailEvents.type, "queued")));
    expect(queued.length).toBe(1);

    // Idempotent replay returns the same message, not a second send.
    const replay = await call("/v1/emails", {
      method: "POST",
      headers: { "idempotency-key": idem },
      body: JSON.stringify({
        from: senderA,
        to: "ada@example.test",
        template: `welcome-${suffix}`,
        variables: { name: "Ada", code: "482915" },
      }),
    });
    expect(replay.status).toBe(200);
    const replayed = await json<{ id: string }>(replay);
    expect(replayed.id).toBe(sentEmailId);
  });

  it("refuses a send with a missing variable and queues nothing", async () => {
    if (!(await reachable())) return;
    const { getDb, emails } = await import("@calder/db");
    const { count, eq } = await import("drizzle-orm");
    const db = getDb();
    const [before] = await db.select({ value: count() }).from(emails).where(eq(emails.projectId, projectA));

    const send = await call("/v1/emails", {
      method: "POST",
      body: JSON.stringify({
        from: senderA,
        to: "ada@example.test",
        template: `welcome-${suffix}`,
        variables: { name: "Ada" },
      }),
    });
    expect(send.status).toBe(400);
    const body = await json<{ error: { code: string; message: string } }>(send);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("code");

    const [after] = await db.select({ value: count() }).from(emails).where(eq(emails.projectId, projectA));
    expect(after?.value).toBe(before?.value);
  });

  it("keeps templates tenant-isolated in both directions", async () => {
    if (!(await reachable())) return;
    // Project B cannot read, version, send or delete project A's template.
    const read = await call(`/v1/templates/${templateId}`, {}, keyB);
    expect(read.status).toBe(404);

    const version = await call(
      `/v1/templates/${templateId}/versions`,
      { method: "POST", body: JSON.stringify({ subject: "hijack", html: "<p>x</p>" }) },
      keyB
    );
    expect(version.status).toBe(404);

    const send = await call(
      "/v1/emails",
      {
        method: "POST",
        body: JSON.stringify({
          from: "someone@b.test",
          to: "ada@example.test",
          template: `welcome-${suffix}`,
          variables: { name: "Ada", code: "1" },
        }),
      },
      keyB
    );
    expect(send.status).toBe(404);

    const del = await call(`/v1/templates/${templateId}`, { method: "DELETE" }, keyB);
    expect(del.status).toBe(404);
  });

  it("deletes safely without destroying delivery history", async () => {
    if (!(await reachable())) return;
    const { getDb, emails } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    const del = await call(`/v1/templates/${templateId}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const gone = await call(`/v1/templates/${templateId}`);
    expect(gone.status).toBe(404);

    // The email sent from that template is a historical record and stays.
    const [row] = await db.select().from(emails).where(eq(emails.id, sentEmailId)).limit(1);
    expect(row).toBeDefined();
    expect(row!.subject).toContain("Ada");
  });
});
