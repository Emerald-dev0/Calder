import { and, eq, inArray } from "drizzle-orm";
import { organizationMembers, users, type DbClient } from "@calder/db";
import { companyEmailDefinition, type CompanyEmailId } from "./catalogue.js";
import { sendCompanyEmail, type SendCompanyEmailResult } from "./send.js";
import type { RenderUrls } from "./render/templates.js";

/**
 * Workspace-addressed mail.
 *
 * A billing failure or a broken webhook concerns the workspace, not one
 * person, so it goes to the people who can act on it: owners and admins.
 * Members do not need to know that a card expired — sending it to everyone
 * trains people to ignore the one email that mattered.
 *
 * Each recipient gets their own row and their own idempotency key
 * (`<key>:<userId>`), so a replay does not double-send to half the team.
 */

export interface OrganizationRecipient {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

export async function resolveOrganizationRecipients(
  db: DbClient,
  organizationId: string
): Promise<OrganizationRecipient[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.role, ["owner", "admin"])
      )
    );

  // De-duplicate: one address, one email, even if the row somehow repeats.
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SendOrganizationEmailParams {
  id: CompanyEmailId;
  organizationId: string;
  data?: Record<string, unknown>;
  /** Base key for the event; each recipient's row gets `:userId` appended. */
  idempotencyKey: string;
  urls?: Partial<RenderUrls>;
}

export interface SendOrganizationEmailResult {
  sent: number;
  skipped: number;
  failed: number;
  recipients: number;
  results: Array<SendCompanyEmailResult & { userId: string }>;
}

export async function sendOrganizationEmail(
  db: DbClient,
  params: SendOrganizationEmailParams
): Promise<SendOrganizationEmailResult> {
  const definition = companyEmailDefinition(params.id);
  if (!definition) throw new Error(`Unknown company email: ${params.id}`);
  if (definition.audience !== "organization") {
    throw new Error(`${params.id} is addressed to a person, not a workspace`);
  }

  const recipients = await resolveOrganizationRecipients(db, params.organizationId);
  const results: Array<SendCompanyEmailResult & { userId: string }> = [];

  for (const recipient of recipients) {
    const result = await sendCompanyEmail(db, {
      id: params.id,
      to: recipient.email,
      userId: recipient.userId,
      organizationId: params.organizationId,
      data: { ...params.data, name: params.data?.name ?? recipient.name ?? undefined },
      idempotencyKey: `${params.idempotencyKey}:${recipient.userId}`,
      urls: params.urls,
    });
    results.push({ ...result, userId: recipient.userId });
  }

  return {
    recipients: recipients.length,
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
