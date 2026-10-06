import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getConfig } from "@calder/config";
import type { DbClient, DbExecutor, DbTransaction } from "./client.js";
import {
  checkOrganizationQuota,
  INTERNAL_ORGANIZATION_ID,
  type OrganizationQuotaDecision,
} from "./usage.js";
import { apiKeys } from "./schema/api-keys.js";
import { auditLogs } from "./schema/system.js";
import { emails } from "./schema/emails.js";
import { organizations, type Organization } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";

export type OrganizationSendingBlockReason =
  | "organization_not_found"
  | "project_not_found"
  | "project_organization_mismatch"
  | "organization_abuse_paused"
  | "organization_suspended"
  | "new_organization_limit"
  | "plan_quota";

export interface OrganizationSendingDecision {
  allowed: boolean;
  reason?: OrganizationSendingBlockReason;
  status?: Organization["sendingStatus"];
  organizationCreatedAt?: Date;
  windowEndsAt?: Date;
  acceptedInWindow?: number;
  quota?: OrganizationQuotaDecision;
}

export interface OrganizationSendingConfig {
  newOrganizationSendLimit: number;
  newOrganizationWindowHours: number;
}

export function getOrganizationSendingConfig(): OrganizationSendingConfig {
  const config = getConfig();
  return {
    newOrganizationSendLimit: config.ORG_NEW_SEND_LIMIT,
    newOrganizationWindowHours: config.ORG_NEW_SEND_WINDOW_HOURS,
  };
}

/** Pure day-one-cap calculation. The restriction window starts at org creation. */
export function evaluateNewOrganizationSendLimit(input: {
  organizationCreatedAt: Date;
  now: Date;
  acceptedInWindow: number;
  incoming?: number;
  organizationId?: string;
  env: "test" | "live";
  config?: OrganizationSendingConfig;
}): OrganizationSendingDecision {
  const config = input.config ?? getOrganizationSendingConfig();
  const windowEndsAt = new Date(
    input.organizationCreatedAt.getTime() + config.newOrganizationWindowHours * 60 * 60 * 1000
  );
  if (
    input.env !== "live" ||
    input.organizationId === INTERNAL_ORGANIZATION_ID ||
    input.now.getTime() >= windowEndsAt.getTime()
  ) {
    return { allowed: true, windowEndsAt, acceptedInWindow: input.acceptedInWindow };
  }
  const accepted = Math.max(0, input.acceptedInWindow);
  const incoming = Math.max(0, input.incoming ?? 1);
  return {
    allowed: accepted + incoming <= config.newOrganizationSendLimit,
    reason:
      accepted + incoming <= config.newOrganizationSendLimit ? undefined : "new_organization_limit",
    windowEndsAt,
    acceptedInWindow: accepted,
  };
}

async function readOrganization(
  db: DbExecutor,
  organizationId: string,
  lock: boolean
): Promise<Organization | undefined> {
  const query = db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const rows = lock ? await query.for("update") : await query;
  return rows[0];
}

async function countLiveAcceptedDuringNewOrgWindow(
  db: DbExecutor,
  organizationId: string,
  organizationCreatedAt: Date,
  windowEndsAt: Date
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(emails)
    .innerJoin(projects, eq(emails.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(emails.env, "live"),
        gte(emails.createdAt, organizationCreatedAt),
        lt(emails.createdAt, windowEndsAt)
      )
    );
  return Number(row?.value ?? 0);
}

async function evaluateEligibility(
  db: DbExecutor,
  input: {
    organizationId: string;
    projectId?: string;
    env: "test" | "live";
    phase: "ingest" | "delivery";
    incoming: number;
    now: Date;
  },
  lock: boolean
): Promise<OrganizationSendingDecision> {
  const organization = await readOrganization(db, input.organizationId, lock);
  if (!organization) return { allowed: false, reason: "organization_not_found" };

  if (input.projectId) {
    const [project] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) return { allowed: false, reason: "project_not_found" };
    if (project.organizationId !== input.organizationId) {
      return { allowed: false, reason: "project_organization_mismatch" };
    }
  }

  if (organization.sendingStatus !== "active") {
    return {
      allowed: false,
      reason:
        organization.sendingStatus === "abuse_paused"
          ? "organization_abuse_paused"
          : "organization_suspended",
      status: organization.sendingStatus,
    };
  }

  if (input.phase === "delivery") {
    return { allowed: true, status: organization.sendingStatus };
  }

  // Existing plan quota is checked under the same org-row lock as this
  // organization's day-one ceiling and insert. This closes concurrent
  // requests across projects/keys without changing the provider-accept meter.
  const quota = await checkOrganizationQuota(
    db,
    input.organizationId,
    input.env,
    input.incoming,
    input.now
  );
  if (!quota.allowed) {
    return {
      allowed: false,
      reason: "plan_quota",
      status: organization.sendingStatus,
      quota,
    };
  }

  const config = getOrganizationSendingConfig();
  const windowEndsAt = new Date(
    organization.createdAt.getTime() + config.newOrganizationWindowHours * 60 * 60 * 1000
  );
  const acceptedInWindow =
    input.env === "live" &&
    input.organizationId !== INTERNAL_ORGANIZATION_ID &&
    input.now.getTime() < windowEndsAt.getTime()
      ? await countLiveAcceptedDuringNewOrgWindow(
          db,
          input.organizationId,
          organization.createdAt,
          windowEndsAt
        )
      : 0;
  const dayOne = evaluateNewOrganizationSendLimit({
    organizationId: input.organizationId,
    organizationCreatedAt: organization.createdAt,
    now: input.now,
    acceptedInWindow,
    incoming: input.incoming,
    env: input.env,
    config,
  });
  if (!dayOne.allowed) {
    return {
      ...dayOne,
      allowed: false,
      reason: "new_organization_limit",
      status: organization.sendingStatus,
      organizationCreatedAt: organization.createdAt,
    };
  }
  return {
    ...dayOne,
    allowed: true,
    status: organization.sendingStatus,
    organizationCreatedAt: organization.createdAt,
  };
}

/**
 * Non-locking status check for API authentication-adjacent and worker delivery
 * gates. It deliberately omits ingest quotas: messages already accepted into
 * the queue are not re-counted at delivery.
 */
export function checkOrganizationSendingEligibility(
  db: DbExecutor,
  input: {
    organizationId: string;
    projectId?: string;
    env?: "test" | "live";
    phase?: "ingest" | "delivery";
    incoming?: number;
    now?: Date;
  }
): Promise<OrganizationSendingDecision> {
  return evaluateEligibility(
    db,
    {
      organizationId: input.organizationId,
      projectId: input.projectId,
      env: input.env ?? "live",
      phase: input.phase ?? "delivery",
      incoming: input.incoming ?? 1,
      now: input.now ?? new Date(),
    },
    false
  );
}

/**
 * Atomically evaluate org eligibility and persist an accepted send. Locking the
 * organization row serializes all project/key sends against both the day-one
 * count and manual/automatic state changes. The callback must persist the
 * accepted email and its initial event on this transaction.
 */
export async function withOrganizationSendingEligibility<T>(
  db: DbClient,
  input: {
    organizationId: string;
    projectId: string;
    env: "test" | "live";
    incoming?: number;
    now?: Date;
  },
  persist: (tx: DbTransaction, organization: Organization) => Promise<T>
): Promise<
  | { allowed: true; value: T; decision: OrganizationSendingDecision }
  | {
      allowed: false;
      decision: OrganizationSendingDecision;
    }
> {
  return db.transaction(async (tx) => {
    const decision = await evaluateEligibility(
      tx,
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        env: input.env,
        phase: "ingest",
        incoming: input.incoming ?? 1,
        now: input.now ?? new Date(),
      },
      true
    );
    if (!decision.allowed) return { allowed: false, decision } as const;
    const organization = await readOrganization(tx, input.organizationId, false);
    // The locked row was already established above; this only preserves a
    // narrow type for the callback and cannot disappear inside this tx.
    if (!organization) {
      return {
        allowed: false,
        decision: { allowed: false, reason: "organization_not_found" },
      } as const;
    }
    const value = await persist(tx, organization);
    return { allowed: true, value, decision } as const;
  });
}

export async function checkProjectSendingEligibility(
  db: DbExecutor,
  projectId: string,
  input: { env?: "test" | "live"; phase?: "ingest" | "delivery"; now?: Date } = {}
): Promise<OrganizationSendingDecision> {
  const [project] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { allowed: false, reason: "project_not_found" };
  return checkOrganizationSendingEligibility(db, {
    organizationId: project.organizationId,
    projectId,
    env: input.env,
    phase: input.phase ?? "delivery",
    now: input.now,
  });
}

/** Project-scoped counterpart used by dashboard sends without an API-key org context. */
export async function withProjectSendingEligibility<T>(
  db: DbClient,
  input: { projectId: string; env: "test" | "live"; incoming?: number; now?: Date },
  persist: (tx: DbTransaction, organizationId: string) => Promise<T>
): Promise<
  | { allowed: true; value: T; decision: OrganizationSendingDecision }
  | { allowed: false; decision: OrganizationSendingDecision }
> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) {
      return {
        allowed: false,
        decision: { allowed: false, reason: "project_not_found" },
      } as const;
    }
    const decision = await evaluateEligibility(
      tx,
      {
        organizationId: project.organizationId,
        projectId: input.projectId,
        env: input.env,
        phase: "ingest",
        incoming: input.incoming ?? 1,
        now: input.now ?? new Date(),
      },
      true
    );
    if (!decision.allowed) return { allowed: false, decision } as const;
    const value = await persist(tx, project.organizationId);
    return { allowed: true, value, decision } as const;
  });
}

export class OrganizationNotActiveError extends Error {
  readonly code = "organization_sending_unavailable";
  readonly statusCode = 403;
  readonly transient = false;

  constructor() {
    super("Sending is currently unavailable for this organization.");
    this.name = "OrganizationNotActiveError";
  }
}

export class OrganizationSendingStatusIdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";

  constructor() {
    super("A different sending-safety request already used this Idempotency-Key.");
    this.name = "OrganizationSendingStatusIdempotencyConflictError";
  }
}

/** Founder/platform-admin kill-switch with organization-wide key revocation and audit. */
export async function setOrganizationSendingStatus(
  db: DbClient,
  input: {
    organizationId: string;
    status: "active" | "suspended";
    actorUserId: string | null;
    actor?: "control_plane" | "admin_api_key";
    reason: string;
    idempotencyKey: string;
    now?: Date;
  }
): Promise<{
  previousStatus: Organization["sendingStatus"];
  status: "active" | "suspended";
  revokedKeyCount: number;
}> {
  const reason = input.reason.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (reason.length < 6 || reason.length > 500) {
    throw new Error("A reason between 6 and 500 characters is required.");
  }
  if (idempotencyKey.length < 1 || idempotencyKey.length > 255) {
    throw new Error("An Idempotency-Key between 1 and 255 characters is required.");
  }
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, sendingStatus: organizations.sendingStatus })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .for("update");
    if (!organization) throw new Error("Organization not found.");

    const actor = input.actor ?? "control_plane";
    const [priorAction] = await tx
      .select({ actorUserId: auditLogs.actorUserId, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, input.organizationId),
          inArray(auditLogs.action, [
            "organization.sending.suspended",
            "organization.sending.resumed",
          ]),
          sql`${auditLogs.metadata}->>'idempotencyKey' = ${idempotencyKey}`
        )
      )
      .limit(1);
    if (priorAction) {
      const metadata = priorAction.metadata ?? {};
      const sameRequest =
        metadata.to === input.status &&
        metadata.reason === reason &&
        metadata.actor === actor &&
        priorAction.actorUserId === input.actorUserId;
      if (!sameRequest) throw new OrganizationSendingStatusIdempotencyConflictError();
      return {
        previousStatus: metadata.from as Organization["sendingStatus"],
        status: input.status,
        revokedKeyCount: Number(metadata.revokedKeyCount ?? 0),
      };
    }

    let revokedKeyCount = 0;
    if (input.status === "suspended") {
      const orgProjects = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, input.organizationId));
      const projectIds = orgProjects.map((project) => project.id);
      if (projectIds.length > 0) {
        const revoked = await tx
          .update(apiKeys)
          .set({ revokedAt: now })
          .where(and(inArray(apiKeys.projectId, projectIds), isNull(apiKeys.revokedAt)))
          .returning({ id: apiKeys.id });
        revokedKeyCount = revoked.length;
      }
    }

    await tx
      .update(organizations)
      .set({
        sendingStatus: input.status,
        sendingStatusReason: reason,
        sendingStatusAt: now,
        sendingStatusActorUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(eq(organizations.id, input.organizationId));
    await tx.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action:
        input.status === "suspended"
          ? "organization.sending.suspended"
          : "organization.sending.resumed",
      targetType: "organization",
      targetId: input.organizationId,
      metadata: {
        from: organization.sendingStatus,
        to: input.status,
        reason,
        actor,
        revokedKeyCount,
        idempotencyKey,
      },
      createdAt: now,
    });
    return {
      previousStatus: organization.sendingStatus,
      status: input.status,
      revokedKeyCount,
    };
  });
}

/**
 * Create a project API key only while the parent organization is active.
 * The organization lock serializes this with suspend-and-revoke, preventing
 * a just-created key from surviving the kill-switch transaction.
 */
export async function insertApiKeyForActiveOrganization(
  db: DbClient,
  projectId: string,
  values: typeof apiKeys.$inferInsert
) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project || values.projectId !== projectId) throw new OrganizationNotActiveError();
    const organization = await readOrganization(tx, project.organizationId, true);
    if (!organization || organization.sendingStatus !== "active") {
      throw new OrganizationNotActiveError();
    }
    return tx.insert(apiKeys).values(values).returning();
  });
}

/**
 * Atomically revoke an active key and create its replacement while holding the
 * organization lock used by the suspension kill-switch. This closes the race
 * where rotation could otherwise create a key after a concurrent suspension.
 */
export async function rotateApiKeyForActiveOrganization(
  db: DbClient,
  projectId: string,
  oldKeyId: string,
  values: typeof apiKeys.$inferInsert
) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project || values.projectId !== projectId) throw new OrganizationNotActiveError();
    const organization = await readOrganization(tx, project.organizationId, true);
    if (!organization || organization.sendingStatus !== "active") {
      throw new OrganizationNotActiveError();
    }
    const [oldKey] = await tx
      .select()
      .from(apiKeys)
      .where(
        and(eq(apiKeys.id, oldKeyId), eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt))
      )
      .limit(1)
      .for("update");
    if (!oldKey) throw new Error("API key not found.");

    const [revoked] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(apiKeys.id, oldKeyId), eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt))
      )
      .returning({ id: apiKeys.id });
    if (!revoked) throw new Error("API key was revoked during rotation.");
    const [created] = await tx.insert(apiKeys).values(values).returning();
    return { oldKey, created };
  });
}
