import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { getConfig } from "@calder/config";

/**
 * Envelope encryption for recoverable secrets (webhook signing secrets,
 * Gmail refresh tokens). AES-256-GCM with a context-separated key so a
 * ciphertext from one domain never decrypts in another.
 *
 * Format: `<iv-hex>:<ciphertext-hex>:<tag-hex>`. Decrypt only at send/sign
 * time; never log, never return to clients.
 */
function contextKey(context: string): Buffer {
  const secret = getConfig().AUTH_SECRET;
  if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters.");
  return createHash("sha256").update(`calder:${context}:${secret}`).digest();
}

export function encryptSecret(raw: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", contextKey(context), iv);
  const ct = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${ct.toString("hex")}:${cipher.getAuthTag().toString("hex")}`;
}

export function decryptSecret(stored: string, context: string): string {
  const [ivHex, ctHex, tagHex] = stored.split(":");
  if (!ivHex || !ctHex || !tagHex) throw new Error("Malformed encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", contextKey(context), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(ctHex, "hex"), undefined, "utf8") + decipher.final("utf8");
}
