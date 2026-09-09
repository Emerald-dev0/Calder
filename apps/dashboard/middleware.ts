import { NextResponse, type NextRequest } from "next/server";

// Mirrors SESSION_COOKIE from @calder/auth. Deliberately not imported: the
// barrel pulls node:crypto (via api-keys) which cannot bundle for the Edge
// runtime this middleware runs on. Keep in sync by hand, it changes never.
const SESSION_COOKIE = "calder_session";

/**
 * Fast cookie-presence gate only. Real enforcement happens per-page in
 * lib/auth.ts (seal + expiry + revocation checked server-side). Do not rely
 * on this middleware alone for authorization.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/illustrations/") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  if (!req.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
