import type { BillingProvider, CheckoutSession } from "./provider.js";

export interface BillingService {
  createCheckout(
    organizationId: string,
    planId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSession>;
  verifyWebhook(payload: string, signature: string, secret?: string): boolean;
  getProviderName(): string;
}

export function createBillingService(provider: BillingProvider): BillingService {
  return {
    createCheckout: (
      organizationId: string,
      planId: string,
      successUrl: string,
      cancelUrl: string
    ): Promise<CheckoutSession> =>
      provider.createCheckoutSession({ organizationId, planId, successUrl, cancelUrl }),

    // Delegated, never short-circuited: this used to `return false`, which
    // meant a correctly signed webhook could never be accepted. The provider
    // performs the timing-safe HMAC comparison against its own secret.
    verifyWebhook: (payload: string, signature: string): boolean =>
      provider.verifyWebhookSignature(payload, signature),

    getProviderName: (): string => provider.name,
  };
}
