import { randomBytes } from "node:crypto";
import {
  encryptSecret as encryptWithContext,
  decryptSecret as decryptWithContext,
} from "@calder/auth";

/**
 * Webhook signing secrets must be recoverable (HMAC needs the raw secret),
 * so they are AES-256-GCM encrypted, never plaintext, never one-way hashed.
 *
 * Exactly one encryption scheme is used across the platform: @calder/auth's
 * context-separated envelope encryption under "webhook_signing". The REST
 * API (apps/api/src/routes/webhooks.ts) encrypts with the same scheme so the
 * delivery engine (webhook signer) has a single contract to decrypt against.
 */
const CONTEXT = "webhook_signing";

export function encryptSecret(raw: string): string {
  return encryptWithContext(raw, CONTEXT);
}

export function decryptSecret(stored: string): string {
  return decryptWithContext(stored, CONTEXT);
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}
