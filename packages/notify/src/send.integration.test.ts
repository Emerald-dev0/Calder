import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise, same
// convention as the API suite.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

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

const gate = ENABLED ? describe : describe.skip;

/**
 * What only a real database can prove:
 *  - the unique index on idempotency_key is what makes retries safe;
 *  - a skipped row is actually durable, so support can see we did not send;
 *  - workspace mail resolves owners and admins, not members.
 */
gate("company email delivery (live Postgres)", () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const userId = `user_ce_${suffix}`;
  const orgId = `org_ce_${suffix}`;
  const otherUserId = `user_ce_member_${suffix}`;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";
    const dbModule = await import("@calder/db");
    const { getDb, users, organizations, organizationMembers } = dbModule;
    const db = getDb();
    await db.insert(users).values([
      { id: userId, email: `owner_${suffix}@example.com`, name: "Owner" },
      { id: otherUserId, email: `member_${suffix}@example.com`, name: "Member" },
    ]);
    await db.insert(organizations).values({ id: orgId, name: `Ce ${suffix}`, slug: `ce-${suffix}` });
    await db.insert(organizationMembers).values([
      { id: `mem_a_${suffix}`, organizationId: orgId, userId, role: "owner" },
      { id: `mem_b_${suffix}`, organizationId: orgId, userId: otherUserId, role: "member" },
    ]);
  });

  afterAll(async () => {
    const { getDb, users, organizations } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    // company_emails rows cascade away with the user (SET NULL on delete, so
    // clear by email first), then the org and users.
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  it("claims a key once and records the replay", async () => {
    if (!(await reachable())) return;
    const { sendCompanyEmail } = await import("./send.js");
    const { getDb } = await import("@calder/db");
    const db = getDb();
    const key = `itest:once:${suffix}`;

    const first = await sendCompanyEmail(db, {
      id: "account.welcome",
      to: `owner_${suffix}@example.com`,
      userId,
      idempotencyKey: key,
      data: { name: "Owner" },
    });
    const second = await sendCompanyEmail(db, {
      id: "account.welcome",
      to: `owner_${suffix}@example.com`,
      userId,
      idempotencyKey: key,
      data: { name: "Owner" },
    });

    expect(first.replay).toBe(false);
    expect(second.replay).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe(first.status);
  });

  it("persists an opt-out skip instead of a silent no-op", async () => {
    if (!(await reachable())) return;
    const { sendCompanyEmail } = await import("./send.js");
    const { setCategoryDisabled } = await import("./preferences.js");
    const { getDb } = await import("@calder/db");
    const db = getDb();

    await setCategoryDisabled(db, userId, "updates", true);
    const result = await sendCompanyEmail(db, {
      id: "updates.product_update",
      to: `owner_${suffix}@example.com`,
      userId,
      idempotencyKey: `itest:optout:${suffix}`,
      data: { title: "Shipped", body: "Something" },
    });

    expect(result).toMatchObject({ status: "skipped", skipReason: "opted_out" });

    // And a mandatory category is unaffected by the same preference row.
    const mandatory = await sendCompanyEmail(db, {
      id: "billing.payment_failed",
      to: `owner_${suffix}@example.com`,
      userId,
      idempotencyKey: `itest:mandatory:${suffix}`,
      data: { amount: "₦5,000", planName: "Builder" },
    });
    expect(mandatory.status).not.toBe("skipped");
  });

  it("addresses a workspace email to owners and admins only", async () => {
    if (!(await reachable())) return;
    const { resolveOrganizationRecipients, sendOrganizationEmail } = await import("./recipients.js");
    const { getDb } = await import("@calder/db");
    const db = getDb();

    const recipients = await resolveOrganizationRecipients(db, orgId);
    expect(recipients.map((r) => r.userId)).toEqual([userId]);

    const result = await sendOrganizationEmail(db, {
      id: "operations.api_key_created",
      organizationId: orgId,
      idempotencyKey: `itest:apikey:${suffix}`,
      data: { keyName: "prod", keyPrefix: "sk_live_abc", env: "live", createdBy: "test" },
    });
    expect(result.recipients).toBe(1);
    expect(result.results.every((r) => r.status !== "skipped")).toBe(true);
  });
});
