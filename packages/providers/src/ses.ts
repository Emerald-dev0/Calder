import { SESv2Client, SendEmailCommand, GetAccountCommand } from "@aws-sdk/client-sesv2";
import type { Attachment as SesAttachment } from "@aws-sdk/client-sesv2";
import type { EmailProvider, EmailMessage, ProviderSendResult, ProviderError } from "@calder/email";

// Typed against the SDK's Attachment shape so a wrong field name is a compile
// error, not a silently dropped attachment in production. (FileContentType is
// not a SES field — the SDK's structural typing would let it through unchecked.)
const toSesAttachment = (a: {
  filename: string;
  contentType?: string;
  contentBase64: string;
}): SesAttachment => ({
  FileName: a.filename,
  ContentType: a.contentType ?? "application/octet-stream",
  RawContent: Buffer.from(a.contentBase64, "base64"),
});

/**
 * AWS SES provider, initial production provider.
 * Isolated behind EmailProvider interface so API/worker never import AWS SDK directly.
 */
export class SesEmailProvider implements EmailProvider {
  readonly name = "ses";
  private client: SESv2Client;

  constructor(client?: SESv2Client) {
    this.client =
      client ??
      new SESv2Client({
        region: process.env.AWS_REGION ?? "us-east-1",
        // Credentials from env/IAM role automatically
      });
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    try {
      const attachments = (message.attachments ?? []).map(toSesAttachment);
      const cmd = new SendEmailCommand({
        FromEmailAddress: message.from,
        // Publish delivery events through this configuration set when set.
        // Without it, feedback exists only if the identity has a default
        // configuration set assigned — an optional fallback, not the plan.
        ...(process.env.SES_CONFIGURATION_SET
          ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET }
          : {}),
        Destination: {
          ToAddresses: [message.to],
          CcAddresses: message.cc ? [message.cc] : undefined,
          BccAddresses: message.bcc ? [message.bcc] : undefined,
        },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Html: message.html ? { Data: message.html, Charset: "UTF-8" } : undefined,
              Text: message.text ? { Data: message.text, Charset: "UTF-8" } : undefined,
            },
            Headers: message.headers
              ? Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value }))
              : undefined,
            Attachments: attachments.length > 0 ? attachments : undefined,
          },
        },
        EmailTags: message.tags?.map((t) => ({ Name: t.name, Value: t.value })),
      });

      const result = await this.client.send(cmd);
      return {
        providerMessageId: result.MessageId ?? `ses_${Date.now()}`,
        provider: this.name,
        accepted: true,
      };
    } catch (err: unknown) {
      const error = err as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
      const providerError = new Error(error.message ?? "SES send failed") as ProviderError;
      providerError.name = error.name ?? "SesError";
      providerError.code = error.name ?? "SesError";
      const status = error.$metadata?.httpStatusCode;
      // Throttling and timeouts are transient; validation errors are permanent.
      //
      // Name matching alone is a trap: SESv2 reports rate limiting as
      // `TooManyRequestsException` (HTTP 429), not the legacy
      // `ThrottlingException` — so a rate-limited live send was classified
      // permanent and the customer's mail was failed instead of retried.
      // The HTTP status is authoritative, and the name list is the fallback
      // for error shapes that arrive without one.
      const transientByName = [
        "TooManyRequestsException",
        "ThrottlingException",
        "Throttling",
        // Sending is paused (typically reputation); it resumes on its own.
        "SendingPausedException",
        "TimeoutError",
        "RequestTimeout",
        "ServiceUnavailable",
        "InternalFailure",
      ].some((c) => error.name?.includes(c));
      const transientByStatus =
        status !== undefined && (status === 429 || (status >= 500 && status < 600));
      providerError.transient = transientByStatus || transientByName;
      if (status) providerError.statusCode = status;
      else if (providerError.transient) providerError.statusCode = 503;
      else providerError.statusCode = 400;
      throw providerError;
    }
  }
}

export function createSesProvider(region?: string): SesEmailProvider {
  if (region) {
    return new SesEmailProvider(new SESv2Client({ region }));
  }
  return new SesEmailProvider();
}

export interface SesAccountStatus {
  /** Sandbox accounts can only send to verified recipients. Launch blocker. */
  sandbox: boolean;
  enforcementStatus: string | null;
  max24HourSend: number;
  sentLast24Hours: number;
  /** 0 in sandbox; anything above means real sending rate is available. */
  maxSendRate: number;
}

/**
 * SES account status, the single most common silent launch failure. A brand
 * new AWS account is in the sandbox, where sending to an unverified address is
 * rejected (or silently dropped in some flows). `/ready` cannot see this, it
 * needs an API call, so this is used by the launch check and by operators.
 */
export async function getSesAccountStatus(client?: SESv2Client): Promise<SesAccountStatus> {
  const ses = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const account = await ses.send(new GetAccountCommand({}));
  return {
    sandbox: account.ProductionAccessEnabled !== true,
    enforcementStatus: account.EnforcementStatus ?? null,
    max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
    sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
    maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
  };
}

// ---- M4.2: deliverability identity (DKIM) linkage --------------------------

export interface SesIdentityDnsRecord {
  name: string;
  type: string;
  value: string;
}

/**
 * Register a domain as a SES sending identity. Returns the three CNAME
 * records the tenant must publish for DKIM signing. Idempotent on AWS's side:
 * re-creating an existing identity returns the same tokens.
 */
export async function createSesDomainIdentity(
  domain: string,
  client?: SESv2Client
): Promise<{ records: SesIdentityDnsRecord[]; dkimStatus: string }> {
  const { CreateEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
  const c = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const out = await c.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
  const tokens = out.DkimAttributes?.Tokens ?? [];
  if (tokens.length === 0) throw new Error("SES returned no DKIM tokens for the identity");
  return {
    dkimStatus: out.DkimAttributes?.Status ?? "PENDING",
    records: tokens.map((token) => ({
      name: `${token}._domainkey.${domain}`,
      type: "CNAME",
      value: `${token}.dkim.amazonses.com`,
    })),
  };
}

/** Poll the identity's verification/DKIM status (propagation-tolerant). */
export async function getSesDomainIdentity(
  domain: string,
  client?: SESv2Client
): Promise<{ verifiedForSending: boolean; dkimStatus: string }> {
  const { GetEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
  const c = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const out = await c.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
  return {
    verifiedForSending: out.VerifiedForSendingStatus === true,
    dkimStatus: out.DkimAttributes?.Status ?? "NOT_STARTED",
  };
}
