import { randomUUID } from "node:crypto";
import type { EmailProvider, EmailMessage, ProviderSendResult } from "@calder/email";

/**
 * Calder Email Provider — reserved seam for dogfooding.
 *
 * Architectural rule (see docs/SYSTEM-EXPLAINED.md "Dogfooding doctrine"):
 * internal sends enter at ENQUEUE time through the same code path as the API,
 * never by looping the worker back through this provider. A provider that
 * POSTs to our own API from inside the worker would recurse (worker → API →
 * queue → worker) and fake `accepted: true` would corrupt the event trail.
 * The last mile stays SES/mock; dogfooding happens upstream of it.
 *
 * Status: NOT IMPLEMENTED. Instantiating is fine; calling send() throws until
 * the direct-enqueue path it must delegate to exists.
 */
export class CalderEmailProvider implements EmailProvider {
  readonly name = "calder";

  async send(_message: EmailMessage): Promise<ProviderSendResult> {
    throw new Error(
      "CalderEmailProvider.send() is not implemented: internal mail must enqueue " +
        "directly via the shared email service, never loop through a provider. " +
        "See docs/SYSTEM-EXPLAINED.md."
    );
  }

  /** Stable internal message id shape for future use (no network involved). */
  static internalMessageId(): string {
    return `calder_${randomUUID().replace(/-/g, "")}`;
  }
}

export function createCalderProvider(): CalderEmailProvider {
  return new CalderEmailProvider();
}
