import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  completeOAuth,
  getSessionUser,
  recordSecurityEvent,
  sealSessionCookie,
  sessionCookieHeader,
  SESSION_COOKIE,
  secureFlag,
  type OAuthProvider,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { clientIp } from "../../../../../lib/client-ip";
import { getConfig } from "@calder/config";
import { postLoginRedirect } from "../../../../../lib/control/post-login";
import { sendSecurityEmail } from "../../../../../lib/send-security-email";

/** OAuth landing: validate, link-or-create user, seal session, enter app. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<Response> {
  const { provider: providerParam } = await params;
  const provider = providerParam as OAuthProvider;
  const url = new URL(req.url);
  const redirectOrigin =
    getConfig().NODE_ENV === "production" ? new URL(getConfig().DASHBOARD_URL).origin : url.origin;
  let store: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    store = await cookies();
  } catch {
    // Outside Next.js request context
  }
  const clearOAuthCookies = (response: NextResponse) => {
    const clear = `Path=/; HttpOnly; Max-Age=0; SameSite=Lax${secureFlag()}`;
    response.headers.append("Set-Cookie", `calder_oauth_state=; ${clear}`);
    response.headers.append("Set-Cookie", `calder_oauth_verifier=; ${clear}`);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  if (provider !== "google" && provider !== "github") {
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=provider", redirectOrigin))
    );
  }
  const gate = await getRateLimiter().check(`oauth-callback:ip:${clientIp(req)}`, {
    ...rateLimitPresets.auth,
    keyPrefix: "oauth:callback",
  });
  if (!gate.allowed) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login?error=throttled", redirectOrigin))
    );
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = store?.get("calder_oauth_state")?.value ?? "";
  const [boundProvider, storedStateValue] = stateCookie.split(".", 2);
  const storedState = boundProvider === provider && storedStateValue ? storedStateValue : null;
  const codeVerifier = store?.get("calder_oauth_verifier")?.value ?? null;
  const previous = await getSessionUser(store?.get(SESSION_COOKIE)?.value);

  if (!code || !state || !storedState) {
    return clearOAuthCookies(NextResponse.redirect(new URL("/login?error=denied", redirectOrigin)));
  }
  try {
    const sessionId = await completeOAuth(
      provider,
      code,
      state,
      storedState,
      codeVerifier,
      {
        userAgent: req.headers.get("user-agent"),
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          req.headers.get("x-real-ip")?.trim() ??
          null,
      },
      previous?.sessionId
    );
    const sealed = await sealSessionCookie(sessionId);
    // Role-derived landing: founders enter at /control, everyone else at /.
    const sessionUser = await getSessionUser(sealed);
    const target = sessionUser ? await postLoginRedirect(sessionUser.email) : "/";
    if (sessionUser) {
      await recordSecurityEvent({
        userId: sessionUser.userId,
        action: "auth.login.succeeded",
        metadata: { method: "oauth", provider },
      }).catch(() => {});
      await recordSecurityEvent({
        userId: sessionUser.userId,
        action: "auth.oauth.connected",
        metadata: { provider },
      }).catch(() => {});
      await sendSecurityEmail({ to: sessionUser.email, event: "new_login", provider });
      await sendSecurityEmail({ to: sessionUser.email, event: "oauth_connected", provider });
    }
    const res = NextResponse.redirect(new URL(target, redirectOrigin));
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("Cache-Control", "no-store");
    res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    return clearOAuthCookies(res);
  } catch {
    return clearOAuthCookies(NextResponse.redirect(new URL("/login?error=failed", redirectOrigin)));
  }
}
