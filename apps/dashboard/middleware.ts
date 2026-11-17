import { NextResponse, type NextRequest } from "next/server";
import { featureAvailability } from "@calder/config/features";

// Mirrors SESSION_COOKIE from @calder/auth. Deliberately not imported: the
// barrel pulls node:crypto (via api-keys) which cannot bundle for the Edge
// runtime this middleware runs on. Keep in sync by hand, it changes never.
const SESSION_COOKIE = "calder_session";

/**
 * Routes that belong to a feature the registry says is not usable.
 *
 * These are answered here, before rendering, because the HTTP status can only
 * be decided before the response starts streaming: a `notFound()` thrown from a
 * page after the shell has been flushed renders the not-found UI but leaves the
 * status at 200, which is not what "this page does not exist" means. The pages
 * keep their own guard as well (see `lib/feature-gate.ts`) — this is the status,
 * that is the render.
 */
const UNLAUNCHED_ROUTES: ReadonlyArray<{ prefix: string; feature: "inbound_email" }> = [
  { prefix: "/inbox", feature: "inbound_email" },
  { prefix: "/receiving", feature: "inbound_email" },
];

function unlaunchedFeature(pathname: string) {
  return UNLAUNCHED_ROUTES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

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
    // One-click unsubscribe: the link arrives in an inbox, often in a client
    // with no session. The signed token is the credential, never the cookie.
    pathname.startsWith("/api/unsubscribe/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/illustrations/") ||
    pathname === "/favicon.svg" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/manifest.webmanifest"
  ) {
    return NextResponse.next();
  }
  // A feature that is not launched does not exist as far as the product is
  // concerned: 404, not a Coming Soon page and not a login bounce.
  const unlaunched = unlaunchedFeature(pathname);
  if (unlaunched && !featureAvailability(unlaunched.feature, null).available) {
    // Rewriting to a path with no route renders the app's not-found boundary
    // with a genuine 404 status.
    return NextResponse.rewrite(new URL("/__not-available", req.url));
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
