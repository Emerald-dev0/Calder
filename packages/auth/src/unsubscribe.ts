import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@calder/config";

/**
 * One-click unsubscribe tokens. HMAC-SHA256 over (projectId, email) — no
 * expiry (revocation IS the suppression row; once suppressed the token is
 * moot). Tamper-evident: any altered token fails verification.
 */
function signingKey(): Buffer {
  const secret = getConfig().AUTH_SECRET;
  if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return Buffer.from(secret, "utf8");
}

export function signUnsubscribeToken(projectId: string, email: string): string {
  const normalized = email.toLowerCase().trim();
  const payload = Buffer.from(JSON.stringify({ p: projectId, e: normalized }), "utf8").toString(
    "base64url"
  );
  const sig = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): { projectId: string; email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let expected: Buffer;
  try {
    expected = Buffer.from(
      createHmac("sha256", signingKey()).update(payload).digest("base64url"),
      "utf8"
    );
  } catch {
    return null;
  }
  const actual = Buffer.from(sig, "utf8");
  if (expected.length !== actual.length) return null;
  try {
    if (!timingSafeEqual(expected, actual)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      p?: string;
      e?: string;
    };
    if (typeof data.p !== "string" || typeof data.e !== "string" || !data.e.includes("@")) {
      return null;
    }
    return { projectId: data.p, email: data.e };
  } catch {
    return null;
  }
}
