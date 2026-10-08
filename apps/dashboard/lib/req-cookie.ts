import { cookies } from "next/headers";

/**
 * Safely reads a cookie value from Next.js cookies() or falls back to
 * parsing the Request's `Cookie` header if called outside Next.js
 * request context (e.g., in unit/e2e tests that invoke route POST directly).
 */
export async function getReqCookie(req: Request, name: string): Promise<string | undefined> {
  try {
    const store = await cookies();
    return store.get(name)?.value;
  } catch {
    const header = req.headers.get("cookie");
    if (!header) return undefined;
    const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]!) : undefined;
  }
}
