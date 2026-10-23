import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE } from "@calder/auth";

/**
 * The session this browser already had, when there is one.
 *
 * `cookies()` only exists inside a real Next request. Handlers are also driven
 * directly — by the E2E harness and by unit tests — where there is no request
 * store, and `cookies()` throws instead of returning an empty store.
 *
 * This lookup is an optimisation: it lets a sign-in rotate the session the
 * browser was already carrying instead of stranding it as a second live row.
 * It is never an authorisation decision, so an unavailable request context must
 * mean "no previous session" rather than fail the sign-in.
 */
export async function readPreviousSessionId(): Promise<string | null> {
  try {
    const store = await cookies();
    const user = await getSessionUser(store.get(SESSION_COOKIE)?.value);
    return user?.sessionId ?? null;
  } catch {
    return null;
  }
}
