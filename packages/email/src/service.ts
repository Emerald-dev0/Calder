import { addCalderFooter } from "./footer.js";
import type { EmailProvider, EmailMessage, ProviderSendResult } from "./provider.js";

/**
 * EmailService, thin orchestrator around provider abstraction.
 * API / Worker depend on this, NOT directly on SES.
 */
export interface EmailService {
  send(
    message: EmailMessage,
    options?: { removeCalderBranding?: boolean }
  ): Promise<ProviderSendResult>;
  getProviderName(): string;
}

export function createEmailService(provider: EmailProvider): EmailService {
  return {
    async send(
      message: EmailMessage,
      options?: { removeCalderBranding?: boolean }
    ): Promise<ProviderSendResult> {
      return provider.send(options?.removeCalderBranding ? message : addCalderFooter(message));
    },
    getProviderName(): string {
      return provider.name;
    },
  };
}
