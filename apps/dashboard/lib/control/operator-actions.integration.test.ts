import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
const state = vi.hoisted(() => ({ actorId: "", role: "founder", failAudit: false, deny: false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/control/roles", () => import("./roles"));
vi.mock("@/lib/control/guard", () => ({
  requireControl: async () => {
    if (state.deny) throw new Error("No session");
    return { role: state.role, user: { userId: state.actorId }, email: "operator@example.invalid" };
  },
  requireSection: async (section: string) => {
    const { canAccessSection } = await import("./roles");
    if (
      state.deny ||
      !canAccessSection(
        state.role as PlatformRole,
        section as Parameters<typeof canAccessSection>[1]
      )
    )
      throw new Error("Forbidden");
    return { role: state.role, user: { userId: state.actorId }, email: "operator@example.invalid" };
  },
}));
// Fault-inject ONLY the audit insert while using real Postgres transactions.
vi.mock("@calder/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calder/db")>();
  return {
    ...actual,
    getDb: () => {
      const db = actual.getDb();
      return new Proxy(db, {
        get(target, key) {
          if (key === "transaction")
            return (fn: (tx: unknown) => Promise<unknown>) =>
              target.transaction((tx) =>
                fn(
                  new Proxy(tx, {
                    get(transaction, property) {
                      if (property === "insert")
                        return (table: typeof actual.auditLogs) => {
                          if (table === actual.auditLogs && state.failAudit)
                            throw new Error("Injected audit failure");
                          return transaction.insert(table);
                        };
                      const value = Reflect.get(transaction, property);
                      return typeof value === "function" ? value.bind(transaction) : value;
                    },
                  })
                )
              );
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});
import {
  auditLogs,
  closeDb,
  controlIncidents,
  controlIncidentUpdates,
  getDb,
  organizations,
  plans,
  projects,
  projectTransports,
  subscriptions,
  users,
  type PlatformRole,
} from "@calder/db";
import { setPlatformRole as roleAction } from "../../app/control/administration/actions";
import { setSubscription } from "../../app/control/customers/actions";
import { reactivateGmailTransport } from "../../app/control/security/actions";
import { createIncident, updateIncident } from "../../app/control/observability/incidents/actions";
vi.mock("@/lib/control/incident-policy", () => import("./incident-policy"));

function setPlatformRole(userId: string, role: PlatformRole | null, reason: string, key?: string) {
  return roleAction(
    userId,
    role,
    reason,
    key ?? createHash("sha256").update(`${userId}:${role}:${reason}`).digest("hex")
  );
}

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "operator actions (real Postgres)",
  () => {
    const id = `operator_qa_${randomUUID()}`;
    const targetId = `${id}_target`,
      founderId = `${id}_founder`,
      orgId = `${id}_org`,
      projectId = `${id}_project`,
      transportId = `${id}_transport`;
    const incidentIds = [`inc_${randomUUID()}`, `inc_${randomUUID()}`];
    beforeAll(async () => {
      state.actorId = `${id}_actor`;
      const db = getDb();
      await db.insert(users).values([
        { id: state.actorId, email: `${id}@example.invalid`, platformRole: "founder" },
        { id: targetId, email: `${id}_target@example.invalid` },
        { id: founderId, email: `${id}_founder@example.invalid`, platformRole: "founder" },
      ]);
      await db.insert(organizations).values({ id: orgId, name: "Operator QA", slug: orgId });
      await db
        .insert(projects)
        .values({ id: projectId, organizationId: orgId, name: "QA", slug: "qa" });
      await db.insert(projectTransports).values({
        id: transportId,
        projectId,
        type: "gmail",
        status: "suspended",
        label: "qa@example.invalid",
      });
      await db
        .insert(plans)
        .values({ id: `${id}_plan`, tier: "free", name: "QA" })
        .onConflictDoNothing();
    });
    beforeEach(() => {
      state.role = "founder";
      state.failAudit = false;
      state.deny = false;
    });
    afterAll(async () => {
      state.failAudit = false;
      await getDb().delete(auditLogs).where(eq(auditLogs.actorUserId, state.actorId));
      await getDb().delete(controlIncidents).where(inArray(controlIncidents.id, incidentIds));
      await getDb().delete(organizations).where(eq(organizations.id, orgId));
      await getDb()
        .delete(users)
        .where(inArray(users.id, [state.actorId, targetId, founderId]));
      await getDb()
        .delete(plans)
        .where(eq(plans.id, `${id}_plan`));
      await closeDb();
    });
    it.each(["platform_admin", "support", "billing", "infrastructure", "security", "analyst"])(
      "denies role/plan grants to %s",
      async (role) => {
        state.role = role;
        expect((await setPlatformRole(targetId, "support", "Test permission boundary")).ok).toBe(
          false
        );
        expect(
          (await setSubscription(orgId, "free", 1, "Test permission boundary", `${id}_${role}`)).ok
        ).toBe(false);
      }
    );
    it("denies unauthenticated calls, self changes and founder target changes", async () => {
      expect((await setPlatformRole(state.actorId, "support", "Test self protection")).ok).toBe(
        false
      );
      expect((await setPlatformRole(founderId, "support", "Test founder protection")).ok).toBe(
        false
      );
      state.deny = true;
      await expect(setPlatformRole(targetId, "support", "Test no session")).rejects.toThrow(
        "No session"
      );
    });
    it("rolls a role change back when its audit insert fails", async () => {
      state.failAudit = true;
      await expect(setPlatformRole(targetId, "support", "Test audit rollback")).rejects.toThrow(
        "Injected audit failure"
      );
      const [row] = await getDb().select().from(users).where(eq(users.id, targetId));
      expect(row?.platformRole).toBeNull();
    });
    it("commits role+audit together and repeated identical assignment is a no-op", async () => {
      expect((await setPlatformRole(targetId, "support", "Reviewed support access")).ok).toBe(true);
      expect((await setPlatformRole(targetId, "support", "Reviewed support access")).ok).toBe(true);
      const rows = await getDb()
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.actorUserId, state.actorId), eq(auditLogs.targetId, targetId)));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toMatchObject({
        from: null,
        to: "support",
        reason: "Reviewed support access",
      });
    });
    it("replaying a grant cannot resurrect access after a later revocation", async () => {
      expect((await setPlatformRole(targetId, null, "Reviewed access revocation")).ok).toBe(true);
      expect((await setPlatformRole(targetId, "support", "Reviewed support access")).ok).toBe(true);
      const [target] = await getDb().select().from(users).where(eq(users.id, targetId));
      expect(target?.platformRole).toBeNull();
    });
    it("rolls a plan grant back on audit failure", async () => {
      state.failAudit = true;
      await expect(
        setSubscription(orgId, "free", 1, "Test grant rollback", `${id}_fail`)
      ).rejects.toThrow("Injected audit failure");
      expect(
        await getDb().select().from(subscriptions).where(eq(subscriptions.organizationId, orgId))
      ).toHaveLength(0);
    });
    it("serializes duplicate plan grants and rejects conflicting key reuse", async () => {
      const args = [orgId, "free", 1, "Reviewed complimentary grant", `${id}_grant`] as const;
      const results = await Promise.all([setSubscription(...args), setSubscription(...args)]);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(
        await getDb().select().from(subscriptions).where(eq(subscriptions.organizationId, orgId))
      ).toHaveLength(1);
      expect((await setSubscription(orgId, "free", 2, args[3], args[4])).ok).toBe(false);
    });
    it("preserves the old active grant when a replacement audit fails", async () => {
      state.failAudit = true;
      await expect(
        setSubscription(orgId, "free", 2, "Test replacing existing grant", `${id}_replace`)
      ).rejects.toThrow("Injected audit failure");
      const rows = await getDb()
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, orgId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("active");
    });
    it("rejects absent reasons, invalid durations and unsupported role grants", async () => {
      expect((await setPlatformRole(targetId, "founder", "Test invalid founder grant")).ok).toBe(
        false
      );
      expect((await setPlatformRole(targetId, "support", "")).ok).toBe(false);
      expect(
        (await setSubscription(orgId, "free", 1.5, "Test invalid grant duration", `${id}_duration`))
          .ok
      ).toBe(false);
      await expect(reactivateGmailTransport(transportId, "")).rejects.toThrow("reason");
      state.role = "support";
      await expect(reactivateGmailTransport(transportId, "Reviewed appeal reason")).rejects.toThrow(
        "Forbidden"
      );
    });
    it("rolls Gmail reactivation back on audit failure, then permits audited resume", async () => {
      state.failAudit = true;
      await expect(reactivateGmailTransport(transportId, "Reviewed Gmail appeal")).rejects.toThrow(
        "Injected audit failure"
      );
      const [row] = await getDb()
        .select()
        .from(projectTransports)
        .where(eq(projectTransports.id, transportId));
      expect(row?.status).toBe("suspended");
      state.failAudit = false;
      await reactivateGmailTransport(transportId, "Reviewed Gmail appeal");
      await reactivateGmailTransport(transportId, "Reviewed Gmail appeal");
      const audits = await getDb()
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, transportId));
      expect(audits).toHaveLength(1);
      expect(audits[0]?.metadata).toMatchObject({ reason: "Reviewed Gmail appeal" });
    });
    it("never resurrects revoked grants or uses Gmail appeal for another transport type", async () => {
      await getDb()
        .update(projectTransports)
        .set({ status: "revoked" })
        .where(eq(projectTransports.id, transportId));
      await expect(
        reactivateGmailTransport(transportId, "Reviewed revoked appeal")
      ).rejects.toThrow("revoked");
      await getDb()
        .update(projectTransports)
        .set({ status: "suspended", type: "ses" })
        .where(eq(projectTransports.id, transportId));
      await expect(
        reactivateGmailTransport(transportId, "Reviewed wrong transport")
      ).rejects.toThrow("Only Gmail");
    });
    it("incident creation is audited, idempotent and rolls back on audit failure", async () => {
      const input = {
        id: incidentIds[0]!,
        title: "Investigate queued work",
        summary: "Synthetic incident investigation only",
        severity: "sev3",
      };
      state.failAudit = true;
      await expect(createIncident(input)).rejects.toThrow("Injected audit failure");
      expect(
        await getDb().select().from(controlIncidents).where(eq(controlIncidents.id, input.id))
      ).toHaveLength(0);
      state.failAudit = false;
      await Promise.all([createIncident(input), createIncident(input)]);
      expect(
        await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, input.id))
      ).toHaveLength(1);
      await expect(
        createIncident({ ...input, title: "Another investigation request" })
      ).rejects.toThrow("already used");
    });
    it("incident edits roll back, reject stale edits and retain an attributed timeline", async () => {
      const input = {
        id: incidentIds[0]!,
        updateId: `inc_${randomUUID()}`,
        revision: 0,
        status: "identified",
        message: "Synthetic cause identified",
      };
      state.failAudit = true;
      await expect(updateIncident(input)).rejects.toThrow("Injected audit failure");
      const [unchanged] = await getDb()
        .select()
        .from(controlIncidents)
        .where(eq(controlIncidents.id, input.id));
      expect(unchanged?.revision).toBe(0);
      expect(
        await getDb()
          .select()
          .from(controlIncidentUpdates)
          .where(eq(controlIncidentUpdates.incidentId, input.id))
      ).toHaveLength(0);
      state.failAudit = false;
      await updateIncident(input);
      await updateIncident(input);
      await expect(updateIncident({ ...input, updateId: `inc_${randomUUID()}` })).rejects.toThrow(
        "Refresh"
      );
      const notes = await getDb()
        .select()
        .from(controlIncidentUpdates)
        .where(eq(controlIncidentUpdates.incidentId, input.id));
      expect(notes).toHaveLength(1);
      expect(notes[0]?.actorUserId).toBe(state.actorId);
      await updateIncident({
        ...input,
        updateId: `inc_${randomUUID()}`,
        revision: 1,
        status: "resolved",
        message: "Synthetic recovery verified",
      });
      const [resolved] = await getDb()
        .select()
        .from(controlIncidents)
        .where(eq(controlIncidents.id, input.id));
      expect(resolved?.resolvedAt).toBeInstanceOf(Date);
      await expect(
        updateIncident({ ...input, updateId: `inc_${randomUUID()}`, revision: 2 })
      ).rejects.toThrow("Resolved");
    });
    it.each(["security", "analyst", "support", "billing"])(
      "does not let %s mutate incidents",
      async (role) => {
        state.role = role;
        await expect(
          createIncident({
            id: incidentIds[1]!,
            title: "Synthetic role test",
            summary: "Must not be persisted",
            severity: "sev4",
          })
        ).rejects.toThrow();
      }
    );
    it("infrastructure operators can record incidents; malformed IDs and transitions fail", async () => {
      state.role = "infrastructure";
      await createIncident({
        id: incidentIds[1]!,
        title: "Synthetic infrastructure incident",
        summary: "Local fixture investigation",
        severity: "sev4",
      });
      await expect(
        updateIncident({
          id: incidentIds[1]!,
          updateId: `inc_${randomUUID()}`,
          revision: 0,
          status: "monitoring",
          message: "Skip identification illegally",
        })
      ).rejects.toThrow("Unsupported");
      await expect(
        createIncident({
          id: "inc_bad",
          title: "Synthetic invalid incident",
          summary: "Local invalid request",
          severity: "sev4",
        })
      ).rejects.toThrow("Valid incident");
    });
  }
);
