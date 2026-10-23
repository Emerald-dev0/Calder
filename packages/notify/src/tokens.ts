import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@calder/config";

/**
 * Tokens that let somebody switch off a category from a footer link, without
 * signing in. Signed rather than random-URL only, so a leaked link cannot be
 * used to change other people's preferences.
 *
 * Scope is deliberately narrow: a token names one user and one category. It
 * cannot enable anything, cannot touch mandatory mail, and cannot be replayed
 * for a different address.
 */

function signingKey(): Buffer {
  const secret = getConfig().AUTH_SECRET;
  if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return Buffer.from(`company-email-prefs|${secret}`, "utf8");
}

export interface PreferenceTokenPayload {
  userId: string;
  category: string;
}

export function signPreferenceToken(userId: string, category: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, c: category }), "utf8").toString(
    "base64url"
  );
  const sig = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPreferenceToken(token: string): PreferenceTokenPayload | null {
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
      u?: unknown;
      c?: unknown;
    };
    if (typeof data.u !== "string" || data.u.length === 0) return null;
    if (typeof data.c !== "string" || data.c.length === 0) return null;
    return { userId: data.u, category: data.c };
  } catch {
    return null;
  }
}
