import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (see scripts/dev-infra.mjs). Skipped otherwise,
// so `pnpm test` stays green on a machine without a database.
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
 * Emails — tenant isolation.
 *
 * The list, the CSV export and the detail panel all read through
 * `lib/emails/queries`, so this suite drives that module directly against a
 * real database with two organizations:
 *
 *  - the detail read for a message id owned by another tenant returns null
 *    (not the row, not an error that leaks its existence);
 *  - the list and the export for project A never contain project B's rows, even
 *    with an empty filter set — the only narrowing in that case is the project;
 *  - a search that matches the *other* tenant's subject does not surface it.
 *
 * If someone later removes the project predicate to "simplify" a query, these
 * assertions fail rather than silently serving another tenant's mail.
 */
gate("emails tenant isolation (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, emails, organizations, organizationMembers, projects, users, cleanupSuiteOrg } =
    await import("@calder/db");
  const { EMPTY_FILTERS } = await import("./filters");
  const { findEmailDetail, listEmails, listEmailsForExport } = await import("./queries");

  const suffix = randomBytes(4).toString("hex");
  const orgA = `org_emt_a_${suffix}`;
  const orgB = `org_emt_b_${suffix}`;
  const userA = `usr_emt_a_${suffix}`;
  const userB = `usr_emt_b_${suffix}`;
  const projectA = `proj_emt_a_${suffix}`;
  const projectB = `proj_emt_b_${suffix}`;
  const emailA = `em_emt_a_${suffix}`;
  const emailB = `em_emt_b_${suffix}`;
  const sharedSubject = `tenant-${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values([
      { id: userA, email: `emt-a-${suffix}@test.test` },
      { id: userB, email: `emt-b-${suffix}@test.test` },
    ]);
    await db.insert(organizations).values([
      { id: orgA, name: "Emails Tenant A", slug: `emt-a-${suffix}` },
      { id: orgB, name: "Emails Tenant B", slug: `emt-b-${suffix}` },
    ]);
    await db.insert(organizationMembers).values([
      { id: `orgm_emt_a_${suffix}`, organizationId: orgA, userId: userA, role: "owner" },
      { id: `orgm_emt_b_${suffix}`, organizationId: orgB, userId: userB, role: "owner" },
    ]);
    await db.insert(projects).values([
      { id: projectA, organizationId: orgA, name: "A", slug: `a-${suffix}` },
      { id: projectB, organizationId: orgB, name: "B", slug: `b-${suffix}` },
    ]);
    await db.insert(emails).values([
      {
        id: emailA,
        projectId: projectA,
        from: "a@tenant-a.test",
        to: "recipient-a@example.test",
        subject: sharedSubject,
        text: "A",
        status: "delivered",
        attemptCount: 0,
      },
      {
        id: emailB,
        projectId: projectB,
        from: "b@tenant-b.test",
        to: "recipient-b@example.test",
        subject: sharedSubject,
        text: "B",
        status: "delivered",
        attemptCount: 0,
      },
    ]);
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await cleanupSuiteOrg(db, orgA, userA);
    await cleanupSuiteOrg(db, orgB, userB);
  });

  it("returns null when the message belongs to another project", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    expect(await findEmailDetail(db, projectA, emailB)).toBeNull();
    expect(await findEmailDetail(db, projectB, emailA)).toBeNull();
  });

  it("returns the message for its own project", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const detail = await findEmailDetail(db, projectA, emailA);
    expect(detail).not.toBeNull();
    expect(detail!.message.id).toBe(emailA);
    expect(detail!.message.to).toBe("recipient-a@example.test");
  });

  it("lists only the scoped project's messages", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const rows = await listEmails(db, {
      projectId: projectA,
      filters: EMPTY_FILTERS,
      cursor: null,
      limit: 200,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(emailA);
    expect(ids).not.toContain(emailB);
  });

  it("does not leak across tenants when a search matches the other tenant", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const rows = await listEmails(db, {
      projectId: projectA,
      filters: { ...EMPTY_FILTERS, q: sharedSubject },
      cursor: null,
      limit: 50,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(emailA);
    expect(ids).not.toContain(emailB);
  });

  it("exports only the scoped project's messages", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const { rows } = await listEmailsForExport(db, { projectId: projectB, filters: EMPTY_FILTERS });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(emailB);
    expect(ids).not.toContain(emailA);
  });

  it("matches the other tenant's provider id only through its own project", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const rows = await listEmails(db, {
      projectId: projectA,
      filters: { ...EMPTY_FILTERS, q: emailB },
      cursor: null,
      limit: 50,
    });
    expect(rows.map((r) => r.id)).not.toContain(emailB);
  });
});
