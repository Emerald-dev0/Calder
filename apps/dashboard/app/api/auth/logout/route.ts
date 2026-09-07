import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSessionUser,
  revokeSession,
  clearSessionCookieHeader,
  SESSION_COOKIE,
} from "@avenor/auth";

export async function POST(req: Request): Promise<Response> {
  const store = cookies();
  const user = await getSessionUser(store.get(SESSION_COOKIE)?.value);
  if (user) await revokeSession(user.sessionId);
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  return res;
}
