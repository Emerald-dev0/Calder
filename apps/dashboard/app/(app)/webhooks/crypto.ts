import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { getConfig } from "@avenor/config";

/**
 * Webhook signing secrets must be recoverable (HMAC needs the raw secret),
 * so they are AES-256-GCM encrypted — never plaintext, never one-way hashed.
 */
function encKey(): Buffer {
  const secret = getConfig().AUTH_SECRET;
  if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return createHash("sha256").update(`whsec:${secret}`).digest();
}

export function encryptSecret(raw: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${ct.toString("hex")}:${cipher.getAuthTag().toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, ctHex, tagHex] = stored.split(":");
  if (!ivHex || !ctHex || !tagHex) throw new Error("Malformed secret.");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(ctHex, "hex"), undefined, "utf8") + decipher.final("utf8");
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}
