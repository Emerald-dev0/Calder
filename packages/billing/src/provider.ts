/**
 * Billing provider abstraction — Bachs is initial candidate, pending validation.
 * No fabricated Bachs API calls — interface only, mock for scaffold.
 */

export interface CheckoutSession {
  id: string;
  url: string;
  customerId?: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  status: "active" | "past_due" | "canceled" | "trialing" | "incomplete";
  planId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface BillingEvent {
  type:
    | "subscription.created"
    | "subscription.updated"
    | "subscription.canceled"
    | "payment.succeeded"
    | "payment.failed";
  data: Record<string, unknown>;
}

export interface BillingProvider {
  readonly name: string;
  createCheckoutSession(params: {
    organizationId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession>;
  getSubscription(subscriptionId: string): Promise<Subscription | null>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
}

/**
 * Mock billing provider for development/test.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock";

  async createCheckoutSession(params: {
    organizationId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    return {
      id: `cs_mock_${Date.now()}`,
      url: `${params.successUrl}?mock_session=${params.planId}`,
      customerId: `cus_mock_${params.organizationId}`,
    };
  }

  async getSubscription(subscriptionId: string): Promise<Subscription | null> {
    if (!subscriptionId.startsWith("sub_")) return null;
    return {
      id: subscriptionId,
      customerId: `cus_mock_${subscriptionId}`,
      status: "active",
      planId: "plan_pro",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }

  async cancelSubscription(_subscriptionId: string): Promise<void> {
    // mock — no-op
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    // In production: HMAC-SHA256 verification. Mock: check secret matches.
    return secret.length > 0 && signature.length > 0 && payload.length > 0;
  }
}
