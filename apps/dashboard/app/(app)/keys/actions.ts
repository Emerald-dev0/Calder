"use server";

import { randomUUID } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, apiKeys } from "@calder/db";
import { generateApiKey } from "@calder/auth";
import { getTenantContext } from "../../../lib/auth";

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function assertProject(projectId: string) {
  const ctx = await getTenantContext();
  const ids = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!ids.has(projectId)) throw new Error("Project not found.");
}

export async function listKeys(projectId: string) {
  await assertProject(projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.keyPrefix,
      env: apiKeys.env,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.projectId, projectId));
  return rows.map((r) => ({
    ...r,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createKey(projectId: string, name: string, env: "test" | "live") {
  await assertProject(projectId);
  const clean = name.trim().slice(0, 100) || `${env} key`;
  const generated = generateApiKey(env);
  const db = getDb();
  const id = rid("key");
  await db.insert(apiKeys).values({
    id,
    projectId,
    name: clean,
    keyPrefix: generated.prefix,
    keyHash: generated.hash,
    env,
  });
  // Secret returned ONCE — the page must display and discard it.
  return { id, secret: generated.secret, prefix: generated.prefix };
}

export async function revokeKey(projectId: string, keyId: string) {
  await assertProject(projectId);
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));
  return { ok: true as const };
}
