import { cookies } from "next/headers";

/**
 * Safely get a cookie value without throwing when called outside a Next.js
 * request storage context (e.g. during direct route handler invocations in tests).
 */
export async function getCookieValue(name: string): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(name)?.value;
  } catch {
    return undefined;
  }
}
