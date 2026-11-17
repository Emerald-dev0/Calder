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
    const { getDb, organizations, organizationMembers, projects, users, senderIdentities } =
      await import("@calder/db");
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
    const { allowRawSenders } = await import("../test-support/senders.js");
    await db.insert(projects).values([
      { id: projectA, organizationId: orgA, name: "A", slug: "a" },
      { id: projectB, organizationId: orgB, name: "B", slug: "b" },
    ]);
    // Stage 3.3: the isolation case sends from a bare address on each project.
    await allowRawSenders(db, projectA);
    await allowRawSenders(db, projectB);
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
    const body = await json<{
      data: { id: string; alias: string; latest_version: { version: string } };
    }>(res);
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
    const one = await json<{
      data: {
        latest_version: { version: string; subject: string; status: string };
        published_version: { version: string } | null;
        draft_version: { version: string } | null;
      };
    }>(detail);
    expect(one.data.latest_version.version).toBe("v2");
    expect(one.data.latest_version.subject).toBe("Welcome aboard, {{name}}");
    // A saved version is a draft: it exists, it is editable, and it is not what
    // sends will pick up until someone publishes it.
    expect(one.data.latest_version.status).toBe("draft");
    expect(one.data.published_version?.version).toBe("v1");
    expect(one.data.draft_version?.version).toBe("v2");
  });

  it("keeps using the published version while a draft is waiting", async () => {
    if (!(await reachable())) return;
    const { getDb, emails } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");

    const res = await call("/v1/emails", {
      method: "POST",
      body: JSON.stringify({
        from: senderA,
        to: "draft-waiting@example.test",
        template: `welcome-${suffix}`,
        variables: { name: "Ada", code: "111111" },
      }),
    });
    expect(res.status).toBe(202);
    const body = await json<{ id: string }>(res);
    const [row] = await getDb().select().from(emails).where(eq(emails.id, body.id)).limit(1);
    // v2 (subject "Welcome aboard…") is a draft; v1 is what recipients get.
    expect(row!.subject).toBe("Welcome, Ada");
    expect(row!.html).toBe("<p>Hi Ada, your code is 111111</p>");
  });

  it("publishes a draft, after which sends use it", async () => {
    if (!(await reachable())) return;
    const publish = await call(`/v1/templates/${templateId}/versions/v2/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(publish.status).toBe(200);
    const published = await json<{
      data: { version: string; status: string; idempotent: boolean };
    }>(publish);
    expect(published.data).toMatchObject({ version: "v2", status: "published", idempotent: false });

    // Publishing twice is a no-op, not an error: retries happen.
    const again = await call(`/v1/templates/${templateId}/versions/v2/publish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(200);
    expect((await json<{ data: { idempotent: boolean } }>(again)).data.idempotent).toBe(true);

    const detail = await call(`/v1/templates/${templateId}`);
    const one = await json<{ data: { published_version: { version: string } | null } }>(detail);
    expect(one.data.published_version?.version).toBe("v2");
  });

  it("refuses to publish a version whose placeholders were never declared", async () => {
    if (!(await reachable())) return;
    const created = await call(`/v1/templates/${templateId}/versions`, {
      method: "POST",
      body: JSON.stringify({
        subject: "Hello {{name}}",
        html: "<p>{{name}} — {{undeclared_thing}}</p>",
        variables: [{ name: "name", required: true }],
      }),
    });
    expect(created.status).toBe(201);
    const body = await json<{ data: { version: string; status: string } }>(created);
    expect(body.data.status).toBe("draft");

    const publish = await call(
      `/v1/templates/${templateId}/versions/${body.data.version}/publish`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    expect(publish.status).toBe(400);
    const refusal = await json<{
      error: { code: string; message: string; details?: { problems?: Array<{ code: string }> } };
    }>(publish);
    expect(refusal.error.message).toContain("undeclared_thing");
    expect(refusal.error.details?.problems?.map((p) => p.code)).toContain("undeclared_variable");

    // And the template still sends the last good published version.
    const detail = await call(`/v1/templates/${templateId}`);
    expect(
      (await json<{ data: { published_version: { version: string } | null } }>(detail)).data
        .published_version?.version
    ).toBe("v2");
  });

  it("previews a draft with sample data, reporting what would block a publish", async () => {
    if (!(await reachable())) return;
    const created = await call(`/v1/templates/${templateId}/versions`, {
      method: "POST",
      body: JSON.stringify({
        subject: "Preview {{name}}",
        html: "<p>Hi {{name}}, {{code}}</p>",
        variables: ["name", "code"],
      }),
    });
    const { data } = await json<{ data: { version: string } }>(created);

    const full = await call(`/v1/templates/${templateId}/versions/${data.version}/preview`, {
      method: "POST",
      body: JSON.stringify({ variables: { name: "Ada", code: "42" } }),
    });
    expect(full.status).toBe(200);
    const rendered = await json<{
      data: {
        status: string;
        rendered: { subject: string; html: string; missing: string[] };
        problems: unknown[];
      };
    }>(full);
    expect(rendered.data.status).toBe("draft");
    expect(rendered.data.rendered.subject).toBe("Preview Ada");
    expect(rendered.data.rendered.html).toBe("<p>Hi Ada, 42</p>");
    expect(rendered.data.rendered.missing).toEqual([]);
    expect(rendered.data.problems).toEqual([]);

    // Missing sample data is reported, not silently blanked.
    const partial = await call(`/v1/templates/${templateId}/versions/${data.version}/preview`, {
      method: "POST",
      body: JSON.stringify({ variables: { name: "Ada" } }),
    });
    const partialBody = await json<{
      data: { rendered: { html: string; missing: string[] }; problems: Array<{ code: string }> };
    }>(partial);
    expect(partialBody.data.rendered.missing).toEqual(["code"]);
    expect(partialBody.data.rendered.html).toContain("{{code}}");
    expect(partialBody.data.problems.map((p) => p.code)).toContain("missing_preview_variable");
  });

  it("refuses to send a template with no published version", async () => {
    if (!(await reachable())) return;
    const created = await call("/v1/templates", {
      method: "POST",
      body: JSON.stringify({ name: "Never published", alias: `empty-${suffix}` }),
    });
    expect(created.status).toBe(201);

    const send = await call("/v1/emails", {
      method: "POST",
      body: JSON.stringify({
        from: senderA,
        to: "ada@example.test",
        template: `empty-${suffix}`,
        variables: {},
      }),
    });
    expect(send.status).toBe(422);
    const body = await json<{ error: { code: string; message: string } }>(send);
    expect(body.error.code).toBe("template_not_published");
    expect(body.error.message).toMatch(/publish/);
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
    const [before] = await db
      .select({ value: count() })
      .from(emails)
      .where(eq(emails.projectId, projectA));

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

    const [after] = await db
      .select({ value: count() })
      .from(emails)
      .where(eq(emails.projectId, projectA));
    expect(after?.value).toBe(before?.value);
  });

  it("renders a React Email element tree into an ordinary version, then sends it", async () => {
    if (!(await reachable())) return;
    const { getDb, emails } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");

    // The tree is data, not source: it is rendered here, and what is stored is
    // plain HTML. Nothing component-shaped survives to send time.
    const created = await call("/v1/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "React receipt",
        alias: `react-${suffix}`,
        subject: "Receipt for {{name}}",
        react_tree: {
          component: "Html",
          children: [
            { component: "Preview", children: ["Your receipt"] },
            {
              component: "Body",
              children: [
                {
                  component: "Container",
                  children: [
                    { component: "Heading", children: ["Thanks, ", "{{name}}"] },
                    { component: "Text", children: ["Order total: {{total}}"] },
                    {
                      component: "Button",
                      props: { href: "{{receipt_url}}" },
                      children: ["View receipt"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    });
    expect(created.status).toBe(201);
    const body = await json<{ data: { id: string } }>(created);

    const send = await call("/v1/emails", {
      method: "POST",
      body: JSON.stringify({
        from: senderA,
        to: "ada@example.test",
        template: `react-${suffix}`,
        variables: { name: "Ada", total: "£42.00", receipt_url: "https://example.test/r/1" },
      }),
    });
    expect(send.status).toBe(202);
    const sent = await json<{ id: string }>(send);

    const [row] = await getDb().select().from(emails).where(eq(emails.id, sent.id)).limit(1);
    expect(row!.subject).toBe("Receipt for Ada");
    // Stored and sent as HTML with the variables filled in.
    expect(row!.html).toContain("<h1");
    expect(row!.html).toContain("Thanks, Ada");
    expect(row!.html).toContain("£42.00");
    expect(row!.html).toContain('href="https://example.test/r/1"');
    expect(row!.html).not.toContain("{{name}}");
    expect(row!.html).not.toContain("component");
    // The text alternative exists, so a plain-text-only client still reads it.
    expect(row!.text).toContain("Order total: £42.00");

    const detail = await call(`/v1/templates/${body.data.id}`);
    const view = await json<{
      data: { latest_version: { version: string; status: string; has_html: boolean } };
    }>(detail);
    expect(view.data.latest_version).toMatchObject({
      version: "v1",
      status: "published",
      has_html: true,
    });
  });

  it("refuses React source code instead of executing it", async () => {
    if (!(await reachable())) return;
    const res = await call("/v1/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Source template",
        alias: `source-${suffix}`,
        subject: "nope",
        react_source: "export default function Email() { return null }",
      }),
    });
    expect(res.status).toBe(400);
    const body = await json<{ error: { message: string } }>(res);
    // The message states the boundary and the two supported paths.
    expect(body.error.message).toContain("does not execute");
  });

  it("refuses an unknown component in a tree rather than dropping it", async () => {
    if (!(await reachable())) return;
    const res = await call("/v1/templates", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad tree",
        alias: `badtree-${suffix}`,
        subject: "nope",
        react_tree: { component: "Tabs", children: ["x"] },
      }),
    });
    expect(res.status).toBe(400);
    const body = await json<{ error: { message: string } }>(res);
    expect(body.error.message).toContain("Unsupported component");
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
          // A sender project B may legitimately use, so the only thing wrong
          // with this request is the cross-tenant template reference. (Stage
          // 3.3 refuses an unauthorised `from` before template lookup, which
          // would otherwise mask the 404 being tested.)
          from: `b-${suffix}@test.test`,
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
