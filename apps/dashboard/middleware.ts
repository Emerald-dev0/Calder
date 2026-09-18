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
    pathname.startsWith("/signup") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/illustrations/") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/manifest.webmanifest"
  ) {
    return NextResponse.next();
  }
  if (!req.cookies.get(SESSION_COOKIE)) {
    // Preserve the deep link so post-login routing can honor it (the API
    // only honors /control* targets for platform roles). "/" is excluded so
    // a founder landing on the root still gets the /control default.
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
