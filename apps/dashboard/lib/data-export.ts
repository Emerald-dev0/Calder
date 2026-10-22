import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@calder/config";

/**
 * Download links for a person's own data.
 *
 * Signed and short-lived rather than stored: there is nothing to clean up, an
 * abandoned link simply stops working, and the link alone is not enough — the
 * export route also requires the session to belong to the same user, so a
 * forwarded email cannot become an exfiltration path.
 */

const TTL_MS = 60 * 60 * 1000;

function key(): Buffer {
  const secret = getConfig().AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return Buffer.from(`data-export|${secret}`, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function signExportToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + TTL_MS);
  const encoded = Buffer.from(JSON.stringify({ u: userId, e: expiresAt.getTime() }), "utf8").toString(
    "base64url"
  );
  return { token: `${encoded}.${sign(encoded)}`, expiresAt };
}

export function verifyExportToken(token: string): { userId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = Buffer.from(sign(encoded), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length) return null;
  try {
    if (!timingSafeEqual(expected, given)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      u?: unknown;
      e?: unknown;
    };
    if (typeof payload.u !== "string" || typeof payload.e !== "number") return null;
    if (payload.e < Date.now()) return null;
    return { userId: payload.u };
  } catch {
    return null;
  }
}
