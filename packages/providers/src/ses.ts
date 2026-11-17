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

  private getConfigSetForStream(stream?: "transactional" | "marketing"): string | undefined {
    if (stream === "marketing") {
      return process.env.SES_CONFIGURATION_SET_BROADCAST ?? process.env.SES_CONFIGURATION_SET;
    }
    return process.env.SES_CONFIGURATION_SET_TRANSACTIONAL ?? process.env.SES_CONFIGURATION_SET;
  }

  async send(
    message: EmailMessage & { stream?: "transactional" | "marketing" }
  ): Promise<ProviderSendResult> {
    try {
      const attachments = (message.attachments ?? []).map(toSesAttachment);
      const configSet = this.getConfigSetForStream(message.stream);
      const cmd = new SendEmailCommand({
        FromEmailAddress: message.from,
        // Publish delivery events through the stream-appropriate configuration set.
        ...(configSet ? { ConfigurationSetName: configSet } : {}),
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
export async function getSesAccountStatus(
  client?: SESv2Client,
  opts: { abortSignal?: AbortSignal } = {}
): Promise<SesAccountStatus> {
  const ses = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  // The abort signal lets a health probe give up on a provider that hangs
  // rather than holding the request open. Optional: callers that want the
  // default SDK behaviour pass nothing.
  const account = await ses.send(new GetAccountCommand({}), {
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
  });
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
): Promise<{
  verifiedForSending: boolean;
  dkimStatus: string;
  configurationSetName: string | null;
}> {
  const { GetEmailIdentityCommand } = await import("@aws-sdk/client-sesv2");
  const c = client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const out = await c.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
  return {
    verifiedForSending: out.VerifiedForSendingStatus === true,
    dkimStatus: out.DkimAttributes?.Status ?? "NOT_STARTED",
    // The identity's default configuration set is how delivery/bounce events
    // reach us when SES_CONFIGURATION_SET is not set on the deployment. If
    // neither exists, mail sends and Calder never learns a bounce happened.
    configurationSetName: out.ConfigurationSetName ?? null,
  };
}

// ---- Account-level suppression (SES is the authority) ----------------------

/**
 * SES keeps one suppression list per AWS *account*, maintained from bounces and
 * complaints. It is not per identity, per configuration set or per customer, and
 * mail to an address on it is refused before it is ever sent.
 *
 * Two operations are needed and they answer different questions:
 *
 *   `getSuppressedDestination`  — is THIS address suppressed right now?
 *                                 Used immediately before delivery.
 *   `listSuppressedDestinations` — what has the account accumulated?
 *                                 Used to mirror the list locally.
 *
 * Both are read-only. Calder must never write to the list: a bounce belongs to
 * whoever observed it, and deleting an entry is an operator decision made in
 * AWS, with the reputation consequences that follow.
 */

/** SES's vocabulary, kept verbatim so a row cannot be mistaken for ours. */
export type SesSuppressionReason = "BOUNCE" | "COMPLAINT";

export type SesSuppressedDestination =
  | { suppressed: false }
  | {
      suppressed: true;
      reason: SesSuppressionReason;
      /** When SES last updated the entry, if it reported one. */
      lastUpdateTime: Date | null;
    };

function sesClient(client?: SESv2Client): SESv2Client {
  return client ?? new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
}

/**
 * Ask SES whether one address is suppressed.
 *
 * `NotFoundException` is the SDK's way of saying "not on the list" — a normal
 * answer, not an error, and treating it as one would make every clean send a
 * failure. Any other error is thrown so the caller can decide what an
 * unverifiable answer means (the delivery path fails closed).
 */
export async function getSuppressedDestination(
  email: string,
  client?: SESv2Client
): Promise<SesSuppressedDestination> {
  const { GetSuppressedDestinationCommand } = await import("@aws-sdk/client-sesv2");
  try {
    const out = await sesClient(client).send(
      new GetSuppressedDestinationCommand({ EmailAddress: email })
    );
    const reason = out.SuppressedDestination?.Reason;
    return {
      suppressed: true,
      reason: reason === "COMPLAINT" ? "COMPLAINT" : "BOUNCE",
      lastUpdateTime: out.SuppressedDestination?.LastUpdateTime ?? null,
    };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NotFoundException" || name === "BadRequestException") {
      // BadRequest covers addresses SES refuses to look up (malformed). It is
      // not a suppression, and the send will fail on its own if it is invalid.
      return { suppressed: false };
    }
    throw err;
  }
}

export interface SesSuppressedDestinationEntry {
  email: string;
  reason: SesSuppressionReason;
  lastUpdateTime: Date | null;
}

/**
 * One page of the account suppression list.
 *
 * `nextToken` is whatever SES returned; null means the listing is complete.
 * There is no `NextToken` on the last page, which is why "done" is expressed as
 * null rather than as an empty array — an empty page mid-listing is legal.
 */
export async function listSuppressedDestinations(
  opts: {
    pageSize?: number;
    nextToken?: string | null;
    /** Only entries updated at or after this instant. */
    since?: Date;
    client?: SESv2Client;
  } = {}
): Promise<{ entries: SesSuppressedDestinationEntry[]; nextToken: string | null }> {
  const { ListSuppressedDestinationsCommand } = await import("@aws-sdk/client-sesv2");
  const out = await sesClient(opts.client).send(
    new ListSuppressedDestinationsCommand({
      PageSize: opts.pageSize ?? 1000,
      ...(opts.nextToken ? { NextToken: opts.nextToken } : {}),
      ...(opts.since ? { StartDate: opts.since } : {}),
    })
  );
  const entries = (out.SuppressedDestinationSummaries ?? []).flatMap((entry) => {
    const email = entry.EmailAddress;
    if (!email) return [];
    return [
      {
        email,
        reason: entry.Reason === "COMPLAINT" ? ("COMPLAINT" as const) : ("BOUNCE" as const),
        lastUpdateTime: entry.LastUpdateTime ?? null,
      },
    ];
  });
  return { entries, nextToken: out.NextToken ?? null };
}
