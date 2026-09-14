import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { completeGmailConnect, saveGmailTransport } from "@calder/auth";
import { getDb } from "@calder/db";
import { getTenantContext } from "../../../../../lib/auth";
import { recordMilestone } from "../../../../(app)/onboarding/actions";

function statesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function clearCookie(name: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * GET /api/auth/gmail/callback — Google returns here after the user grants
 * gmail.send. Exchanges the code, persists the encrypted transport, returns
 * to onboarding. Sign-in and sending stay separate: this grants sending
 * permission only, never a Calder session.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const store = cookies();
  const done = (notice: string) => {
    const res = NextResponse.redirect(new URL(`/onboarding?notice=${notice}`, url.origin));
    for (const n of ["calder_gmail_state", "calder_gmail_verifier", "calder_gmail_project"]) {
      res.headers.append("Set-Cookie", clearCookie(n));
    }
    return res;
  };

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const storedState = store.get("calder_gmail_state")?.value ?? "";
  const verifier = store.get("calder_gmail_verifier")?.value ?? "";
  const projectId = store.get("calder_gmail_project")?.value ?? "";
  if (!code || !state || !statesEqual(state, storedState) || !verifier || !projectId) {
    return done("gmail-failed");
  }

  try {
    const ctx = await getTenantContext().catch(() => null);
    if (!ctx) return done("gmail-failed");
    const { senderEmail, refreshToken } = await completeGmailConnect(code, verifier);
    const { senderId } = await saveGmailTransport({
      userId: ctx.user.userId,
      projectId,
      senderEmail,
      refreshToken,
    });
    await recordMilestone(getDb(), {
      actorUserId: ctx.user.userId,
      action: "onboarding.gmail_connected",
      targetId: projectId,
    });
    if (senderId) {
      await recordMilestone(getDb(), {
        actorUserId: ctx.user.userId,
        action: "onboarding.sender_created",
        targetId: senderId,
      });
    }
    return done("gmail-ok");
  } catch {
    return done("gmail-failed");
  }
}
