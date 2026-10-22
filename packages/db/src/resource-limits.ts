import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  checkResourceLimit,
  planFor,
  type LimitedResource,
  type PlanLimit,
  type ResourceLimitDecision,
} from "@calder/config";
import type { DbExecutor } from "./client.js";
import { apiKeys, domains, organizationMembers, orgInvitations, projects, senderIdentities } from "./schema/index.js";
import { resolveOrgTier } from "./usage.js";

/**
 * Organization-level resource limits.
 *
 * The plan catalogue (`@calder/config`) decides *what* the ceiling is; this
 * module decides *how much is used* and turns the two into one answer. Every
 * creation path — API route, dashboard action, onboarding — calls
 * `checkOrganizationResource`, so a limit cannot be enforced in one place and
 * forgotten in another.
 *
 * Two deliberate rules:
 *
 *  1. **Creation only.** Nothing here runs on reads or updates, so an
 *     organization that is already over a ceiling (because it was created on a
 *     bigger plan, or before this existed) keeps everything it has. It simply
 *     cannot add more.
 *  2. **Archived and revoked things do not count.** An archived sender or a
 *     revoked key is not consuming a slot; otherwise archiving would be a
 *     punishment instead of a cleanup.
 */

export interface ResourceUsage {
  projects: number;
  domains: number;
  senders: number;
  seats: number;
  /** Invitations not yet accepted and not expired. */
  pendingInvites: number;
  tier: string;
  plan: PlanLimit;
}

/**
 * Count what this organization currently holds against each enforced ceiling.
 *
 * Senders are counted across the organization, not per project: the plan sells
 * "5 sender identities", and counting them per project would multiply the
 * allowance by the number of projects.
 */
export async function organizationResourceUsage(
  db: DbExecutor,
  organizationId: string
): Promise<ResourceUsage> {
  const [tier, projectRows] = await Promise.all([
    resolveOrgTier(db, organizationId),
    db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId)),
  ]);
  const projectIds = projectRows.map((p) => p.id);

  const [domainRow, senderRow, memberRow, inviteRow] = await Promise.all([
    projectIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(domains)
          .where(inArray(domains.projectId, projectIds)),
    projectIds.length === 0
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(senderIdentities)
          .where(
            and(
              inArray(senderIdentities.projectId, projectIds),
              // Archived senders keep their history but stop consuming a slot.
              isNull(senderIdentities.archivedAt)
            )
          ),
    db
      .select({ value: count() })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId)),
    db
      .select({ value: count() })
      .from(orgInvitations)
      .where(
        and(
          eq(orgInvitations.organizationId, organizationId),
          isNull(orgInvitations.acceptedAt),
          gt(orgInvitations.expiresAt, new Date())
        )
      ),
  ]);

  return {
    projects: projectIds.length,
    domains: Number(domainRow[0]?.value ?? 0),
    senders: Number(senderRow[0]?.value ?? 0),
    seats: Number(memberRow[0]?.value ?? 0),
    pendingInvites: Number(inviteRow[0]?.value ?? 0),
    tier,
    plan: planFor(tier),
  };
}

/**
 * `used` for one resource, as the catalogue counts it.
 *
 * Seats are "members plus pending invitations": an invite that has been sent
 * but not accepted is already a promised seat, and counting it only on
 * acceptance would let an owner invite thirty people on a one-seat plan.
 */
export function usedFor(usage: ResourceUsage, resource: LimitedResource): number {
  return resource === "seats" ? usage.seats + usage.pendingInvites : usage[resource];
}

export interface ResourceDecision extends ResourceLimitDecision {
  organizationId: string;
  used: number;
  /** Effective usage breakdown, for the UI that shows "3 of 3 projects". */
  usage: ResourceUsage;
}

/**
 * May this organization create one more `resource`?
 *
 * Internal and test tiers are exempt exactly as they are in the send-quota
 * path (the catalogue returns `allowed: true` for them), so an internal
 * workspace is never told it is over Beginner's ceiling.
 */
export async function checkOrganizationResource(
  db: DbExecutor,
  organizationId: string,
  resource: LimitedResource
): Promise<ResourceDecision> {
  const usage = await organizationResourceUsage(db, organizationId);
  const used = usedFor(usage, resource);
  const decision = checkResourceLimit(usage.tier, resource, used);
  return { ...decision, organizationId, used, usage };
}

/**
 * Throw a stable, machine-readable refusal.
 *
 * The error carries `code: "plan_limit_reached"` and the fields a caller needs
 * to render the message and an upgrade link, so the API and the dashboard can
 * both use it verbatim.
 */
export class ResourceLimitError extends Error {
  readonly code = "plan_limit_reached";
  readonly statusCode = 402;
  readonly resource: LimitedResource;
  readonly limit: number | null;
  readonly used: number;
  readonly tier: string;
  readonly displayName: string;
  readonly upgradeTier: string | null;
  readonly upgradeDisplayName: string | null;

  constructor(decision: ResourceDecision) {
    super(decision.message ?? `${decision.displayName} plan limit reached.`);
    this.name = "ResourceLimitError";
    this.resource = decision.resource;
    this.limit = decision.limit;
    this.used = decision.used;
    this.tier = decision.tier;
    this.displayName = decision.displayName;
    this.upgradeTier = decision.upgradeTier ?? null;
    this.upgradeDisplayName = decision.upgradeDisplayName ?? null;
  }
}

/**
 * Assert-and-return: the creation paths call this immediately before an
 * INSERT, so the count and the write are as close together as the caller can
 * manage without holding a transaction across validation.
 */
export async function assertCanCreateResource(
  db: DbExecutor,
  organizationId: string,
  resource: LimitedResource
): Promise<ResourceDecision> {
  const decision = await checkOrganizationResource(db, organizationId, resource);
  if (!decision.allowed) throw new ResourceLimitError(decision);
  return decision;
}

/** The organization a project belongs to, or null when the project is gone. */
export async function organizationForProject(
  db: DbExecutor,
  projectId: string
): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.organizationId ?? null;
}

/**
 * Active API keys for a project. Used by the sender editor to render the
 * "allowed keys" selector; a sender with no grants is unrestricted.
 */
export async function activeApiKeysForProject(
  db: DbExecutor,
  projectId: string
): Promise<Array<{ id: string; name: string; env: string; keyPrefix: string }>> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      env: apiKeys.env,
      keyPrefix: apiKeys.keyPrefix,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)))
    .orderBy(sql`${apiKeys.createdAt} DESC`);
  return rows;
}
