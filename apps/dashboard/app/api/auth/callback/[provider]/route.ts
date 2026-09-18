import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  completeOAuth,
  getSessionUser,
  sealSessionCookie,
  sessionCookieHeader,
  secureFlag,
  type OAuthProvider,
} from "@calder/auth";
import { postLoginRedirect } from "../../../../../lib/control/post-login";

/** OAuth landing: validate, link-or-create user, seal session, enter app. */
export async function GET(
  req: Request,
  { params }: { params: { provider: string } }
): Promise<Response> {
  const provider = params.provider as OAuthProvider;
  const url = new URL(req.url);
  const store = cookies();

  if (provider !== "google" && provider !== "github") {
    return NextResponse.redirect(new URL("/login?error=provider", url.origin));
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = store.get("calder_oauth_state")?.value ?? null;
  const codeVerifier = store.get("calder_oauth_verifier")?.value ?? null;

  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=denied", url.origin));
  }
  try {
    const sessionId = await completeOAuth(provider, code, state, storedState, codeVerifier);
    const sealed = await sealSessionCookie(sessionId);
    // Role-derived landing: founders enter at /control, everyone else at /.
    const sessionUser = await getSessionUser(sealed);
    const target = sessionUser ? await postLoginRedirect(sessionUser.email) : "/";
    const res = NextResponse.redirect(new URL(target, url.origin));
    res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    const clear = `Path=/; HttpOnly; Max-Age=0; SameSite=Lax${secureFlag()}`;
    res.headers.append("Set-Cookie", `calder_oauth_state=; ${clear}`);
    res.headers.append("Set-Cookie", `calder_oauth_verifier=; ${clear}`);
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?error=failed", url.origin));
  }
}
