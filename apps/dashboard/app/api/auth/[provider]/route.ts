import { NextResponse } from "next/server";
import { startOAuth, secureFlag, type OAuthProvider } from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { clientIp } from "../../../../lib/client-ip";

const COOKIE_OPTS = `Path=/; HttpOnly; Max-Age=600; SameSite=Lax${secureFlag()}`;

/** Begin OAuth: stash state/verifier in short-lived cookies, redirect out. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
): Promise<Response> {
  const gate = await getRateLimiter().check(`oauth-start:ip:${clientIp(req)}`, {
    ...rateLimitPresets.auth,
    keyPrefix: "oauth:start",
  });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many OAuth attempts. Try again later." },
      { status: 429 }
    );
  }
  const { provider: providerParam } = await params;
  const provider = providerParam as OAuthProvider;
  if (provider !== "google" && provider !== "github") {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  let started;
  try {
    started = startOAuth(provider);
  } catch {
    return NextResponse.json({ error: "OAuth is not configured." }, { status: 500 });
  }
  const res = NextResponse.redirect(started.url);
  // Bind the callback cookie to the provider as well as the random state. A
  // state value issued for Google must not be replayed on the GitHub callback
  // path (the callback otherwise has no provider binding until after state
  // validation).
  res.headers.append(
    "Set-Cookie",
    `calder_oauth_state=${provider}.${started.state}; ${COOKIE_OPTS}`
  );
  if (started.codeVerifier) {
    res.headers.append(
      "Set-Cookie",
      `calder_oauth_verifier=${started.codeVerifier}; ${COOKIE_OPTS}`
    );
  }
  return res;
}
