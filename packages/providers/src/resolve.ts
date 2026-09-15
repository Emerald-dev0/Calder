import { MockEmailProvider, type EmailProvider } from "@calder/email";
import { SesEmailProvider } from "./ses.js";

/**
 * Provider resolution, one place, so no surface silently degrades.
 *
 * The failure mode this exists to prevent: a deploy ships without AWS
 * credentials, every "confirmation email" path falls back to the mock provider,
 * the API still answers 200, and users wait forever for mail that never left
 * the building. In development the mock is correct (it exercises the pipeline
 * without sending). In production it is an outage, and it must be loud.
 */
export class EmailProviderNotConfiguredError extends Error {
  readonly code = "email_provider_not_configured";

  constructor(missing: string[]) {
    super(
      `No deliverable email provider is configured (missing: ${missing.join(", ")}). ` +
        `Confirmation, verification, and password-reset mail cannot be sent. ` +
        `Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (and AWS_REGION) before launching.`
    );
    this.name = "EmailProviderNotConfiguredError";
  }
}

export interface EmailProviderStatus {
  /** The provider to send through, always non-null. */
  provider: EmailProvider;
  /** "ses" delivers real mail; "mock" records sends and delivers nothing. */
  driver: "ses" | "mock";
  /** True only when mail actually leaves the building. */
  deliverable: boolean;
  /** Log-safe explanation when we are not on a real provider. Null when configured. */
  reason: string | null;
  /**
   * Non-fatal configuration gaps worth warning about: SES accepts an
   * individually verified address, so a missing from-domain is "sends may be
   * rejected until the identity is verified", not "cannot send".
   */
  warnings: string[];
}

export interface ResolveEmailProviderOptions {
  /**
   * Force the mock provider even in production. Only for tests, provider
   * conformance runs, and preview environments that must not send real mail.
   */
  allowMock?: boolean;
}

export function resolveEmailProvider(
  env: NodeJS.ProcessEnv = process.env,
  opts: ResolveEmailProviderOptions = {}
): EmailProviderStatus {
  const missingCredentials = [
    ...(env.AWS_ACCESS_KEY_ID ? [] : ["AWS_ACCESS_KEY_ID"]),
    ...(env.AWS_SECRET_ACCESS_KEY ? [] : ["AWS_SECRET_ACCESS_KEY"]),
  ];
  const isProduction = env.NODE_ENV === "production";

  if (missingCredentials.length > 0 && isProduction && !opts.allowMock) {
    throw new EmailProviderNotConfiguredError(missingCredentials);
  }

  if (missingCredentials.length === 0) {
    const warnings: string[] = [];
    if (!env.AWS_REGION) {
      warnings.push("AWS_REGION unset, defaulting to us-east-1.");
    }
    if (!env.SES_FROM_DOMAIN) {
      warnings.push("SES_FROM_DOMAIN unset, sending domains must be individually verified in SES.");
    }
    return {
      provider: new SesEmailProvider(),
      driver: "ses",
      deliverable: true,
      reason: null,
      warnings,
    };
  }

  return {
    provider: new MockEmailProvider({ latencyMs: 50 }),
    driver: "mock",
    deliverable: false,
    reason: `Missing ${missingCredentials.join(", ")}. Mock provider active, sends are simulated and never delivered.`,
    warnings: [],
  };
}
