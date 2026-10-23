import { randomBytes } from "node:crypto";
import { getConfig } from "@calder/config";
import { generateApiKey } from "@calder/auth";
import { eq } from "drizzle-orm";
import { getDb, apiKeys, insertApiKeyForActiveOrganization } from "@calder/db";

/**
 * Trigger a broadcast send in the API.
 *
 * The dashboard cannot import the API's send pipeline (it lives in `apps/api`
 * and drags the queue and provider stack with it), and the API has no
 * session-auth surface. So this mints a short-lived, project-scoped key,
 * calls the endpoint, and revokes the key in `finally` — the same pattern the
 * onboarding flow already uses to make a first send.
 *
 * Two properties matter and are tested by reading, not by hoping:
 *  - the key exists only for the duration of this call, and is revoked even
 *    when the call throws;
 *  - the key is scoped to one project, so a bug here cannot send another
 *    tenant's mail.
 */

export interface DispatchResult {
  ok: boolean;
  status?: string;
  error?: string;
  data?: Record<string, unknown>;
}

async function withTemporaryKey<T>(projectId: string, fn: (key: string) => Promise<T>): Promise<T> {
  const db = getDb();
  const generated = generateApiKey("live");
  const keyId = `key_${randomBytes(12).toString("hex")}`;

  await insertApiKeyForActiveOrganization(db, projectId, {
    id: keyId,
    projectId,
    name: "broadcast dispatch (temporary)",
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

async function callApi(path: string, projectId: string, body?: unknown): Promise<DispatchResult> {
  const base = getConfig().API_URL.replace(/\/$/, "");
  return withTemporaryKey(projectId, async (key) => {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `dispatch-${path.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const error = payload?.error as { message?: string } | undefined;
        return { ok: false, error: error?.message ?? `The API answered ${res.status}.` };
      }
      return {
        ok: true,
        data: (payload?.data as Record<string, unknown> | undefined) ?? payload ?? {},
      };
    } catch {
      return { ok: false, error: "Could not reach the sending service. Try again in a moment." };
    }
  });
}

export function dispatchBroadcast(projectId: string, broadcastId: string): Promise<DispatchResult> {
  return callApi(`/v1/broadcasts/${broadcastId}/send`, projectId);
}

export function sendBroadcastTest(
  projectId: string,
  broadcastId: string,
  to: string
): Promise<DispatchResult> {
  return callApi(`/v1/broadcasts/${broadcastId}/test`, projectId, { to });
}

export function cancelBroadcast(projectId: string, broadcastId: string): Promise<DispatchResult> {
  return callApi(`/v1/broadcasts/${broadcastId}/cancel`, projectId);
}
