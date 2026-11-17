"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  assertCanCreateResource,
  attemptReceivingVerification,
  createReceivingDomain,
  getDb,
  organizationForProject,
  receivingDomains,
  ResourceLimitError,
} from "@calder/db";
import { getConfig } from "@calder/config";
import { assertProjectManager } from "../onboarding/actions";

/**
 * Receiving-domain actions.
 *
 * Every one of them starts from the dashboard session (never from an id in the
 * form alone): `assertProjectManager` resolves the caller's memberships, so a
 * project id pasted from another workspace resolves to nothing and the action
 * refuses. The plan ceiling is checked before the row is created — receiving
 * domains are a separate allowance from sending domains.
 */

const rid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export interface ReceivingDnsRecord {
  type: "TXT" | "MX";
  host: string;
  value: string;
  purpose: string;
  /** True when the record may already exist for another purpose. */
  warning?: string;
}

function recordsFor(domain: string, token: string): ReceivingDnsRecord[] {
  const cfg = getConfig();
  return [
    {
      type: "TXT",
      host: `_calder-inbound.${domain}`,
      value: `calder-inbound=${token}`,
      purpose: "Proves you control this domain. Publish it, then check verification.",
    },
    {
      type: "MX",
      host: domain,
      value: `${cfg.INBOUND_MX_HOST} (priority 10)`,
      purpose: "Tells the internet to hand this domain's mail to Calder.",
      warning:
        "Only do this on a domain or subdomain that does not already receive mail. If this name already has MX records for Google Workspace, Microsoft 365 or another provider, use a dedicated subdomain such as inbox.yourdomain.com instead — adding ours alongside theirs splits your mail between two providers.",
    },
  ];
}

export async function addReceivingDomain(projectId: string, domain: string) {
  await assertProjectManager(projectId);
  const db = getDb();

  const organizationId = await organizationForProject(db, projectId);
  if (!organizationId) throw new Error("Project not found.");
  try {
    await assertCanCreateResource(db, organizationId, "receivingDomains");
  } catch (err) {
    if (err instanceof ResourceLimitError) {
      throw new Error(
        err.upgradeDisplayName
          ? `${err.message} Upgrade to ${err.upgradeDisplayName} to add more.`
          : err.message
      );
    }
    throw err;
  }

  const mxHost = getConfig().INBOUND_MX_HOST;
  const result = await createReceivingDomain(db, {
    id: rid("rcd"),
    projectId,
    domain,
    mxHost,
  });

  if (result.kind === "invalid") throw new Error(result.reason);
  if (result.kind === "cross_tenant") {
    throw new Error(
      `${result.domain} is already configured for receiving by another workspace. Remove it there first, or contact support if that is unexpected.`
    );
  }

  revalidatePath("/receiving");
  return {
    created: result.kind === "created",
    id: result.id,
    records: recordsFor(domain.trim().toLowerCase(), result.token),
  };
}

export async function verifyReceivingDomain(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(receivingDomains)
    .where(eq(receivingDomains.id, id))
    .limit(1);
  if (!row) throw new Error("Receiving domain not found.");
  // Re-check membership against the row's own project: the id came from a form.
  await assertProjectManager(row.projectId);

  const outcome = await attemptReceivingVerification(db, { projectId: row.projectId, id });
  revalidatePath("/receiving");

  switch (outcome.kind) {
    case "verified":
      return {
        ok: true as const,
        accepted: outcome.accepting,
        message: outcome.accepting
          ? "Verified. Mail addressed to this domain is now being accepted."
          : "Ownership and MX are correct. Nothing is accepted until the SES receipt rule for this domain exists — that is the one step we cannot do for you.",
      };
    case "txt_missing":
      return {
        ok: false as const,
        message: `No matching TXT record yet at ${outcome.expected.host}. DNS can take a few minutes to propagate.`,
      };
    case "mx_foreign":
      return { ok: false as const, message: outcome.message };
    case "mx_missing":
      return { ok: false as const, message: outcome.message };
    case "dns_error":
      return { ok: false as const, message: outcome.message };
    case "rate_limited":
      return {
        ok: false as const,
        message: `Too many checks. Try again in ${Math.ceil(outcome.retryAfterMs / 60_000)} minutes.`,
      };
    case "not_found":
      return { ok: false as const, message: "Receiving domain not found." };
  }
}

export async function disableReceivingDomain(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(receivingDomains)
    .where(eq(receivingDomains.id, id))
    .limit(1);
  if (!row) throw new Error("Receiving domain not found.");
  await assertProjectManager(row.projectId);

  const { disableReceivingDomain: disable } = await import("@calder/db");
  await disable(db, { projectId: row.projectId, id });
  revalidatePath("/receiving");
  return { ok: true as const };
}

/** Re-check that a row still belongs to a project this user manages. */
export async function assertReceivingDomainAccess(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(receivingDomains)
    .where(eq(receivingDomains.id, id))
    .limit(1);
  if (!row) throw new Error("Receiving domain not found.");
  await assertProjectManager(row.projectId);
  return row;
}

export async function receivingDomainForProject(projectId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(receivingDomains)
    .where(and(eq(receivingDomains.id, id), eq(receivingDomains.projectId, projectId)))
    .limit(1);
  return row ?? null;
}
