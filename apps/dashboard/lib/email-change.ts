import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@calder/config";

/**
 * Signed, self-expiring proof that the person asking to change an address
 * controls the address they are leaving.
 *
 * No table: the token *is* the request. It names the account, the new address
 * and an expiry, and is signed with the deployment secret, so nothing has to be
 * cleaned up, and an abandoned request simply stops working. The old address is
 * the one that receives the link — that is the whole point of a confirmation
 * flow, and it is why a stolen session cannot quietly move an account to an
 * attacker's inbox.
 */

const TTL_MS = 60 * 60 * 1000;

interface Payload {
  /** user id */
  u: string;
  /** current address, lowercased */
  o: string;
  /** new address, lowercased */
  n: string;
  /** expiry, epoch ms */
  e: number;
}

function key(): Buffer {
  const secret = getConfig().AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return Buffer.from(`email-change|${secret}`, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function signEmailChangeToken(input: {
  userId: string;
  from: string;
  to: string;
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + TTL_MS);
  const body: Payload = {
    u: input.userId,
    o: input.from.trim().toLowerCase(),
    n: input.to.trim().toLowerCase(),
    e: expiresAt.getTime(),
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return { token: `${encoded}.${sign(encoded)}`, expiresAt };
}

export type EmailChangeResult =
  | { ok: true; userId: string; from: string; to: string }
  | { ok: false; reason: "malformed" | "expired" };

export function verifyEmailChangeToken(token: string): EmailChangeResult {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(encoded), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length) return { ok: false, reason: "malformed" };
  try {
    if (!timingSafeEqual(expected, given)) return { ok: false, reason: "malformed" };
  } catch {
    return { ok: false, reason: "malformed" };
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<Payload>;
    if (
      typeof payload.u !== "string" ||
      typeof payload.o !== "string" ||
      typeof payload.n !== "string" ||
      typeof payload.e !== "number"
    ) {
      return { ok: false, reason: "malformed" };
    }
    if (payload.e < Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, userId: payload.u, from: payload.o, to: payload.n };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
