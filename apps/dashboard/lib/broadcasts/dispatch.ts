import { getConfig } from "@calder/config";
import { withTemporaryKey } from "../temporary-key";

/**
 * Trigger a broadcast send in the API.
 *
 * The dashboard cannot import the API's send pipeline (it lives in `apps/api`
 * and drags the queue and provider stack with it), and the API has no
 * session-auth surface. So this mints a short-lived, project-scoped key,
 * calls the endpoint, and revokes the key in `finally` — the same pattern the
 * onboarding flow already uses to make a first send.
 */

export interface DispatchResult {
  ok: boolean;
  status?: string;
  error?: string;
  data?: Record<string, unknown>;
}

async function callApi(path: string, projectId: string, body?: unknown): Promise<DispatchResult> {
  const base = getConfig().API_URL.replace(/\/$/, "");
  return withTemporaryKey(projectId, "broadcast dispatch", async (key) => {
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
