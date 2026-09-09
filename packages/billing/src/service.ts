import type { BillingProvider, CheckoutSession } from "./provider";

export interface BillingService {
 createCheckout(
 organizationId: string,
 planId: string,
 successUrl: string,
 cancelUrl: string
 ): Promise<CheckoutSession>;
 verifyWebhook(payload: string, signature: string, secret: string): boolean;
 getProviderName(): string;
}

export function createBillingService(provider: BillingProvider): BillingService {
 return {
 createCheckout: (orgId, planId, successUrl, cancelUrl) =>
 provider.createCheckoutSession({ organizationId: orgId, planId, successUrl, cancelUrl }),
 verifyWebhook: (payload, sig, secret) => provider.verifyWebhookSignature(payload, sig, secret),
 getProviderName: () => provider.name,
 };
}
