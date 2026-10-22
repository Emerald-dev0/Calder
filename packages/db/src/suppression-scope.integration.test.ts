import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Suppression scope, against a real Postgres.
 *
 * The two behaviours this proves are the ones a mistake here would break
 * silently in production:
 *
 *   1. a hard bounce recorded in one project blocks the same address from
 *      every other project in that organization;
 *   2. an unsubscribe never blocks transactional mail, and never leaves the
 *      project it was recorded in.
 *
 * Gated on RUN_INTEGRATION_TESTS so a machine without Postgres skips instead
 * of failing. CI sets it to "1".
 */
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

const SUFFIX = `sg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const ORG_A = `org_a_${SUFFIX}`;
const ORG_B = `org_b_${SUFFIX}`;
const PROJ_A1 = `proj_a1_${SUFFIX}`;
const PROJ_A2 = `proj_a2_${SUFFIX}`;
const PROJ_B1 = `proj_b1_${SUFFIX}`;

gate("suppression scope (live Postgres)", () => {
  let db: Awaited<ReturnType<typeof import("@calder/db").getDb>>;
  let guard: typeof import("./suppression-guard.js");
  let schema: typeof import("./schema/index.js");

  beforeAll(async () => {
    const { getDb } = await import("./client.js");
    guard = await import("./suppression-guard.js");
    schema = await import("./schema/index.js");
    db = getDb();

    await db.insert(schema.organizations).values([
      { id: ORG_A, name: "Org A", slug: `a-${SUFFIX}` },
      { id: ORG_B, name: "Org B", slug: `b-${SUFFIX}` },
    ]);
    await db.insert(schema.projects).values([
      { id: PROJ_A1, organizationId: ORG_A, name: "A1", slug: `a1-${SUFFIX}` },
      { id: PROJ_A2, organizationId: ORG_A, name: "A2", slug: `a2-${SUFFIX}` },
      { id: PROJ_B1, organizationId: ORG_B, name: "B1", slug: `b1-${SUFFIX}` },
    ]);
  });

  afterAll(async () => {
    // Children cascade from projects and organizations.
    await db
      .delete(schema.projects)
      .where(inArray(schema.projects.id, [PROJ_A1, PROJ_A2, PROJ_B1]));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [ORG_A, ORG_B]));
  });

  async function addSuppression(projectId: string, email: string, reason: string) {
    const id = `sup_${Math.random().toString(36).slice(2, 12)}`;
    await db.insert(schema.suppressions).values({ id, projectId, email, reason });
    return id;
  }

  it("a hard bounce in project A1 blocks the address from A2 in the same org", async () => {
    const email = `bounced-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "bounce");

    const blocked = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A2,
      email,
      stream: "transactional",
    });

    expect(blocked).not.toBeNull();
    expect(blocked!.reason).toBe("bounce");
    expect(blocked!.projectId).toBe(PROJ_A1);
    expect(blocked!.crossProject).toBe(true);
    expect(blocked!.blocksAllStreams).toBe(true);
  });

  it("a complaint in project A1 also blocks A2", async () => {
    const email = `complained-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "complaint");

    const blocked = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A2,
      email,
      stream: "marketing",
    });
    expect(blocked?.reason).toBe("complaint");
    expect(blocked!.crossProject).toBe(true);
  });

  it("a bounce in org A does not reach org B", async () => {
    const email = `scoped-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "bounce");

    const blocked = await guard.findBlockingSuppression(db, {
      projectId: PROJ_B1,
      email,
      stream: "transactional",
    });
    expect(blocked).toBeNull();
  });

  it("an unsubscribe does not block a transactional send", async () => {
    const email = `unsub-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "unsubscribe");

    const transactional = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A1,
      email,
      stream: "transactional",
    });
    expect(transactional).toBeNull();
  });

  it("an unsubscribe does block a marketing send, in its own project", async () => {
    const email = `unsub-mkt-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "unsubscribe");

    const marketing = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A1,
      email,
      stream: "marketing",
    });
    expect(marketing?.reason).toBe("unsubscribe");
    expect(marketing!.crossProject).toBe(false);
    expect(marketing!.blocksAllStreams).toBe(false);
  });

  it("an unsubscribe does not leave its project, even for marketing", async () => {
    const email = `unsub-other-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "unsubscribe");

    const fromSibling = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A2,
      email,
      stream: "marketing",
    });
    expect(fromSibling).toBeNull();
  });

  it("a manual block stays project-scoped but stops both streams", async () => {
    const email = `manual-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "manual");

    const here = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A1,
      email,
      stream: "transactional",
    });
    expect(here?.reason).toBe("manual");

    const sibling = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A2,
      email,
      stream: "transactional",
    });
    expect(sibling).toBeNull();
  });

  it("matches the address case-insensitively and ignores surrounding space", async () => {
    const email = `Mixed-${SUFFIX}@Example.test`;
    await addSuppression(PROJ_A1, email.toLowerCase(), "bounce");

    const blocked = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A2,
      email: `  ${email.toUpperCase()}  `,
      stream: "transactional",
    });
    expect(blocked).not.toBeNull();
  });

  it("a project-local row is preferred over a cross-project one", async () => {
    const email = `both-${SUFFIX}@example.test`;
    await addSuppression(PROJ_A1, email, "bounce");
    await addSuppression(PROJ_A2, email, "manual");

    const blocked = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A2,
      email,
      stream: "transactional",
    });
    // The local row explains the block better than the sibling's bounce.
    expect(blocked!.projectId).toBe(PROJ_A2);
    expect(blocked!.crossProject).toBe(false);
  });

  it("an unrelated address is never blocked", async () => {
    const blocked = await guard.findBlockingSuppression(db, {
      projectId: PROJ_A1,
      email: `nobody-${SUFFIX}@example.test`,
      stream: "transactional",
    });
    expect(blocked).toBeNull();
  });

  it("the trigger keeps organization_id populated, which the guard relies on", async () => {
    const email = `trigger-${SUFFIX}@example.test`;
    const id = await addSuppression(PROJ_A2, email, "bounce");
    const [row] = await db
      .select({ organizationId: schema.suppressions.organizationId })
      .from(schema.suppressions)
      .where(and(eq(schema.suppressions.id, id), eq(schema.suppressions.projectId, PROJ_A2)));
    expect(row?.organizationId).toBe(ORG_A);
  });
});
