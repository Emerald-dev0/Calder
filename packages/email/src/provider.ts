/**
 * Email provider abstraction, all sending goes through this interface.
 * AWS SES is initial implementation; mock for dev/test.
 */

export interface EmailMessage {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  // Optional: for tracking, tags etc
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface ProviderSendResult {
  providerMessageId: string;
  provider: string;
  accepted: boolean;
}

export interface ProviderError extends Error {
  code: string;
  transient: boolean;
  statusCode?: number;
}

export function isProviderError(err: unknown): err is ProviderError {
  return (
    err instanceof Error &&
    "transient" in err &&
    typeof (err as ProviderError).transient === "boolean"
  );
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<ProviderSendResult>;
  // Optional batch, not needed for MVP
}

/**
 * Mock provider, simulates delivery without external calls.
 * Used in development, test keys, and CI.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";

  private latencyMs: number;
  private shouldFail: boolean;

  constructor(opts?: { latencyMs?: number; shouldFail?: boolean }) {
    this.latencyMs = opts?.latencyMs ?? 50;
    this.shouldFail = opts?.shouldFail ?? false;
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    if (this.shouldFail) {
      const err = new Error("Mock provider simulated failure") as ProviderError;
      (err as ProviderError).code = "MockFailure";
      (err as ProviderError).transient = true;
      (err as ProviderError).statusCode = 503;
      throw err;
    }

    // Validate basics
    if (!message.to.includes("@")) {
      const err = new Error(`Invalid recipient: ${message.to}`) as ProviderError;
      (err as ProviderError).code = "InvalidRecipient";
      (err as ProviderError).transient = false;
      (err as ProviderError).statusCode = 400;
      throw err;
    }

    return {
      providerMessageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      provider: this.name,
      accepted: true,
    };
  }
}
