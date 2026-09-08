import { NextResponse } from "next/server";
import { startOAuth, type OAuthProvider } from "@calder/auth";

const COOKIE_OPTS = "Path=/; HttpOnly; Max-Age=600; SameSite=Lax";

/** Begin OAuth: stash state/verifier in short-lived cookies, redirect out. */
export async function GET(
  _req: Request,
  { params }: { params: { provider: string } }
): Promise<Response> {
  const provider = params.provider as OAuthProvider;
  if (provider !== "google" && provider !== "github") {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  let started;
  try {
    started = startOAuth(provider);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "OAuth is not configured." },
      { status: 500 }
    );
  }
  const res = NextResponse.redirect(started.url);
  res.headers.append("Set-Cookie", `calder_oauth_state=${started.state}; ${COOKIE_OPTS}`);
  if (started.codeVerifier) {
    res.headers.append(
      "Set-Cookie",
      `calder_oauth_verifier=${started.codeVerifier}; ${COOKIE_OPTS}`
    );
  }
  return res;
}
