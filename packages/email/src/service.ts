import type { EmailProvider, EmailMessage, ProviderSendResult } from "./provider";

/**
 * EmailService, thin orchestrator around provider abstraction.
 * API / Worker depend on this, NOT directly on SES.
 */
export interface EmailService {
  send(message: EmailMessage): Promise<ProviderSendResult>;
  getProviderName(): string;
}

export function createEmailService(provider: EmailProvider): EmailService {
  return {
    async send(message: EmailMessage): Promise<ProviderSendResult> {
      return provider.send(message);
    },
    getProviderName(): string {
      return provider.name;
    },
  };
}
