import type { BillingProvider, CheckoutSession } from "./provider.ts";

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

    verifyWebhook: (
      payload: string,
      signature: string,
      secret?: string
    ): boolean => false,

    getProviderName: (): string => provider.name,
  };
}