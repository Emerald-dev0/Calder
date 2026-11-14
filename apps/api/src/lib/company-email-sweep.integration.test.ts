import { describe, it, expect, beforeAll, vi } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

const captured: Array<{ id: string; data: Record<string, unknown> }> = [];

vi.mock("@calder/notify", () => ({
  sendCompanyEmail: async (_db: unknown, input: { id: string; data?: Record<string, unknown> }) => {
    captured.push({ id: input.id, data: input.data ?? {} });
    return { status: "sent" as const };
  },
  sendOrganizationEmail: async () => ({ status: "sent" as const }),
}));

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
 * The reminder email must link to the dashboard, not to the marketing site.
 *
 * `https://calder.click/invite/<token>` looks like a working link in an email
 * preview and 404s for the person who clicks it — the route only exists in the
 * dashboard app. That shipped once; this test makes it a build failure if it
 * comes back.
 */
gate("company email sweep links (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, orgInvitations, users, cleanupSuiteOrg } =
    await import("@calder/db");
  const { runCompanyEmailSweep } = await import("./company-email-sweep.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_swp_${suffix}`;
  const inviterId = `usr_swp_${suffix}`;
  const inviteId = `inv_swp_${suffix}`;
  const inviteEmail = `sweep-invitee-${suffix}@test.test`;

  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: inviterId, email: `sweep-inviter-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Sweep Org", slug: `sweep-${suffix}` });
    await db.insert(orgInvitations).values({
      id: inviteId,
      organizationId: orgId,
      email: inviteEmail,
      role: "member",
      tokenHash: "0".repeat(64),
      invitedBy: inviterId,
      // Expires inside the 2-day reminder window, created long enough ago that
      // it is not a brand-new invitation.
      expiresAt: new Date(now.getTime() + 1 * DAY),
      createdAt: new Date(now.getTime() - 3 * DAY),
    });
  });

  it("sends the invitation reminder to DASHBOARD_URL", async () => {
    if (!(await reachable())) return;
    process.env.DASHBOARD_URL = "https://app.calder.example.test";
    const { resetConfig } = await import("@calder/config");
    resetConfig();

    captured.length = 0;
    await runCompanyEmailSweep(getDb(), now);

    const reminder = captured.find((c) => c.id === "organization.invitation_reminder");
    expect(reminder).toBeDefined();
    const acceptUrl = String(reminder!.data.acceptUrl);
    expect(acceptUrl.startsWith("https://app.calder.example.test/invite/")).toBe(true);
    // The regression: never the marketing origin.
    expect(acceptUrl).not.toContain("https://calder.click/");
    // The token is the raw one (the row stores only its hash).
    expect(acceptUrl.split("/invite/")[1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rotates the stored hash so the new link — not an old one — is the live one", async () => {
    if (!(await reachable())) return;
    const { eq } = await import("drizzle-orm");
    const [row] = await getDb()
      .select({ tokenHash: orgInvitations.tokenHash })
      .from(orgInvitations)
      .where(eq(orgInvitations.id, inviteId))
      .limit(1);
    expect(row?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.tokenHash).not.toBe("0".repeat(64));
  });

  it("leaves no rows behind", async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(getDb(), orgId, inviterId);
  });
});
