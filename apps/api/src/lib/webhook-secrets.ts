import { randomBytes } from "node:crypto";

/**
 * Signing secrets for outgoing webhooks.
 *
 * Exactly one encryption scheme exists for webhook secrets, shared by the
 * REST API (this file) and the dashboard manager (they hand ciphertexts to
 * the same future delivery engine): @calder/auth's context-separated
 * AES-256-GCM envelope encryption under this context string.
 */
export const WEBHOOK_SECRET_CONTEXT = "webhook_signing";

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}
