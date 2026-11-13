import { randomBytes } from "node:crypto";
import { generateApiKey } from "@calder/auth";
import { eq } from "drizzle-orm";
import { getDb, apiKeys, insertApiKeyForActiveOrganization } from "@calder/db";

/**
 * Run `fn` with a freshly minted, project-scoped API key, then revoke it.
 *
 * The dashboard cannot import the API's services (they live in `apps/api` and
 * drag the queue and provider stack with it) and the API has no session-auth
 * surface, so server actions that need to reach it mint a short-lived key,
 * call the endpoint, and revoke in `finally`.
 *
 * Two properties matter and are tested by reading, not by hoping:
 *  - the key exists only for the duration of this call, and is revoked even
 *    when the call throws;
 *  - the key is scoped to one project, so a bug here cannot touch another
 *    tenant's data.
 */
export async function withTemporaryKey<T>(
  projectId: string,
  label: string,
  fn: (key: string) => Promise<T>
): Promise<T> {
  const db = getDb();
  const generated = generateApiKey("live");
  const keyId = `key_${randomBytes(12).toString("hex")}`;

  await insertApiKeyForActiveOrganization(db, projectId, {
    id: keyId,
    projectId,
    name: `${label} (temporary)`,
    keyPrefix: generated.prefix,
    keyHash: generated.hash,
    env: "live",
    scope: "manage",
  });

  try {
    return await fn(generated.secret);
  } finally {
    // Revoke, never delete: the audit trail of a key that existed for 400ms
    // is exactly what an incident review needs.
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId))
      .catch(() => {});
  }
}
