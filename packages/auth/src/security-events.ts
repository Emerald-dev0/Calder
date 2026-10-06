import { randomBytes } from "node:crypto";
import { auditLogs, getDb } from "@calder/db";

/**
 * Authentication security events use the existing immutable audit log. There
 * is deliberately no second event store: this keeps the dashboard/control
 * plane audit trail and the auth lifecycle on one retention and access model.
 * Metadata is caller-supplied but must be non-sensitive; never pass tokens,
 * passwords, codes, refresh tokens, credentials, or message bodies here.
 */
export type SecurityEventAction =
  | "auth.login.succeeded"
  | "auth.logout"
  | "auth.password.changed"
  | "auth.password.reset"
  | "auth.magic_link.redeemed"
  | "auth.oauth.connected"
  | "auth.oauth.disconnected";

function eventId(): string {
  return `audit_${randomBytes(12).toString("hex")}`;
}

export async function recordSecurityEvent(input: {
  userId: string;
  action: SecurityEventAction;
  targetId?: string;
  /** Only set when the caller has already resolved the active tenant. */
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  // Do not guess a tenant from the user's membership list: users may belong
  // to several organizations, and attaching an auth event to the first one
  // would leak activity into the wrong tenant's audit view. Auth routes omit
  // this field unless they have an explicit active-tenant context.
  await db.insert(auditLogs).values({
    id: eventId(),
    organizationId: input.organizationId ?? null,
    actorUserId: input.userId,
    action: input.action,
    targetType: "user",
    targetId: input.targetId ?? input.userId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}
