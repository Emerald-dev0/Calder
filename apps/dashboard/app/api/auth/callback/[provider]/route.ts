import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  completeOAuth,
  sealSessionCookie,
  sessionCookieHeader,
  type OAuthProvider,
} from "@calder/auth";

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
    const res = NextResponse.redirect(new URL("/", url.origin));
    res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    res.headers.append(
      "Set-Cookie",
      "calder_oauth_state=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
    );
    res.headers.append(
      "Set-Cookie",
      "calder_oauth_verifier=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
    );
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?error=failed", url.origin));
  }
}
