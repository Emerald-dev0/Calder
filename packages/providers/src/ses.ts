import { SESv2Client, SendEmailCommand, GetAccountCommand } from "@aws-sdk/client-sesv2";
import type { EmailProvider, EmailMessage, ProviderSendResult, ProviderError } from "@calder/email";

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
      const attachments = (message.attachments ?? []).map((a) => ({
        FileName: a.filename,
        FileContentType: a.contentType ?? "application/octet-stream",
        RawContent: Buffer.from(a.contentBase64, "base64"),
      }));
      const cmd = new SendEmailCommand({
        FromEmailAddress: message.from,
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
      // SES throttling, timeouts are transient; validation errors are permanent
      const transientCodes = [
        "ThrottlingException",
        "Throttling",
        "TimeoutError",
        "ServiceUnavailable",
      ];
      providerError.transient = transientCodes.some((c) => error.name?.includes(c));
      const status = error.$metadata?.httpStatusCode;
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
export async function getSesAccountStatus(
  client?: SESv2Client
): Promise<SesAccountStatus> {
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
