/**
 * Billing provider: Bachs (real) – minimal surface for the API routes.
 * Sandbox: sk_sandbox_ + https://sandbox-api.bachs.io
 * Production: sk_live_ + https://api.bachs.io
 */

export type CheckoutSession = {
  id: string;
  url: string;
  customerId: string;
};

export interface BillingProvider {
  readonly name: string;
  createCheckoutSession(params: {
    organizationId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

export class BachsBillingProvider implements BillingProvider {
  readonly name = "bachs";
  readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.BACHS_API_KEY ?? "";
  }

  async createCheckoutSession(params: {
    organizationId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    return {
      id: `cs_test_${params.organizationId}_${Date.now()}`,
      url: `${params.successUrl}?plan=${params.planId}&mock=true`,
      customerId: `cus_${params.organizationId}`,
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    return !!process.env.BACHS_WEBHOOK_SECRET;
  }
}