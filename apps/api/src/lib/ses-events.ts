import { createVerify, X509Certificate, randomUUID } from "node:crypto";
import type { DbClient } from "@calder/db";
import { AppError } from "../errors/index.js";

/**
 * SES delivery feedback ingested over SNS HTTPS notifications.
 *
 * SECURITY MODEL (SECURITY.md §6: incoming webhooks are verified, never
 * trusted on shape alone):
 * - Only SignatureVersion "1" is accepted.
 * - The signing certificate is fetched ONLY from an https URL whose host is
 *   an SNS regional endpoint (sns.<region>.amazonaws.com) — an attacker
 *   can sign payloads with their own key, so the cert origin is half the
 *   trust decision.
 * - The RSA-SHA1 signature is verified over the canonical "string to sign"
 *   specified by AWS for SNS messages.
 * - Topic ARNs can additionally be allowlisted via SES_SNS_TOPIC_ARNS;
 *   subscription confirmations are ONLY auto-confirmed when the allowlist
 *   is configured and contains the topic (otherwise anyone could subscribe
 *   our endpoint to their own topic).
 */

export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

export class SesEventError extends AppError {
  constructor(message: string, status: 400 | 500 = 400) {
    super(status === 400 ? "validation_error" : "internal_error", message, status);
    this.name = "SesEventError";
  }
}

/** Parse + validate envelope shape (not authenticity — that is the signature). */
export function parseSnsEnvelope(rawBody: string): SnsEnvelope {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new SesEventError("Body is not valid JSON.");
  }
  const env = body as Partial<SnsEnvelope>;
  const missing = (
    [
      "Type",
      "MessageId",
      "TopicArn",
      "Message",
      "Timestamp",
      "Signature",
      "SigningCertURL",
      "SignatureVersion",
    ] as const
  ).filter((k) => typeof env[k] !== "string" || (env[k] as string).length === 0);
  if (missing.length > 0) {
    throw new SesEventError(`Missing SNS fields: ${missing.join(", ")}.`);
  }
  if (!SNS_TYPES.has(env.Type as string)) {
    // Protocol hygiene: a bogus Type must never fall through to the
    // Notification handling path.
    throw new SesEventError(`Unsupported SNS Type "${env.Type}".`);
  }
  return env as SnsEnvelope;
}

const SNS_TYPES = new Set(["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]);

/**
 * Cert origin allowlist per AWS guidance: https, exact SNS regional host.
 * Everything else (http, lookalike hosts, IP literals) is rejected before
 * any network fetch happens.
 */
export function isAllowedSigningCertUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname);
}

/**
 * Canonical "string to sign" as specified by Amazon SNS (field order and
 * inclusion differ by message Type; Subject included only when present).
 */
export function snsStringToSign(env: SnsEnvelope): string {
  let fields: Array<[string, string | undefined]>;
  if (env.Type === "Notification") {
    fields = [
      ["Message", env.Message],
      ["MessageId", env.MessageId],
      ["Timestamp", env.Timestamp],
      ["TopicArn", env.TopicArn],
      ["Type", env.Type],
    ];
    if (env.Subject !== undefined) {
      // Subject sorts between MessageId and Timestamp.
      fields.splice(2, 0, ["Subject", env.Subject]);
    }
  } else {
    // SubscriptionConfirmation & UnsubscribeConfirmation
    fields = [
      ["Message", env.Message],
      ["MessageId", env.MessageId],
      ["SubscribeURL", env.SubscribeURL],
      ["Timestamp", env.Timestamp],
      ["Token", env.Token],
      ["TopicArn", env.TopicArn],
      ["Type", env.Type],
    ];
  }
  let out = "";
  for (const [name, value] of fields) {
    if (value === undefined) {
      throw new SesEventError(`SNS field ${name} is required for ${env.Type}.`);
    }
    out += `${name}\n${value}\n`;
  }
  return out;
}

type FetchCert = (url: string) => Promise<string>;

const defaultFetchCert: FetchCert = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new SesEventError(`Could not fetch SNS signing certificate (${res.status}).`);
  return res.text();
};

let certFetcher: FetchCert = defaultFetchCert;

/**
 * TEST-ONLY seam: lets integration tests serve the (self-signed) cert for an
 * allowlisted SNS URL without network access. Hard-disabled in production.
 * Signature content and the host allowlist are still enforced regardless.
 */
export function setSnsCertFetcher(fetcher?: FetchCert): void {
  if (process.env.NODE_ENV === "production" && fetcher) {
    throw new Error("setSnsCertFetcher is test-only and disabled in production.");
  }
  certFetcher = fetcher ?? defaultFetchCert;
}

/**
 * Verify the SNS RSA-SHA1 signature. Throws SesEventError(400) on ANY
 * rejection; returns nothing on success.
 */
export async function verifySnsSignature(env: SnsEnvelope): Promise<void> {
  if (env.SignatureVersion !== "1") {
    throw new SesEventError(`Unsupported SNS SignatureVersion "${env.SignatureVersion}".`);
  }
  if (!isAllowedSigningCertUrl(env.SigningCertURL)) {
    throw new SesEventError("SNS SigningCertURL is not an official SNS endpoint.");
  }
  const certPem = await certFetcher(env.SigningCertURL);
  let publicKey;
  try {
    publicKey = new X509Certificate(certPem).publicKey;
  } catch {
    throw new SesEventError("SNS signing certificate is not a valid X.509 certificate.");
  }
  const verifier = createVerify("RSA-SHA1");
  verifier.update(snsStringToSign(env), "utf8");
  let signature: Buffer;
  try {
    signature = Buffer.from(env.Signature, "base64");
  } catch {
    throw new SesEventError("SNS Signature is not base64.");
  }
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  if (!ok) throw new SesEventError("SNS signature verification failed.");
}

// ── SES payload parsing ─────────────────────────────────────────

export interface SesRecipientList {
  emailAddress: string;
  status?: string;
  diagnosticCode?: string;
}

export interface SesMessage {
  eventType: string;
  mail: {
    messageId: string;
    timestamp?: string;
    source?: string;
    destination?: string[];
  };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: SesRecipientList[];
  };
  complaint?: {
    complainedRecipients?: SesRecipientList[];
    complaintFeedbackType?: string;
  };
  delivery?: {
    timestamp?: string;
    recipients?: string[];
    smtpResponse?: string;
    remoteMtaIp?: string;
  };
  open?: { ipAddress?: string; timestamp?: string };
  click?: { ipAddress?: string; link?: string; timestamp?: string };
  reject?: { reason?: string };
  failure?: { errorMessage?: string };
}

/** SES sends either `eventType` (current) or `notificationType` (legacy). */
export function parseSesMessage(env: SnsEnvelope): SesMessage {
  let msg: unknown;
  try {
    msg = JSON.parse(env.Message);
  } catch {
    throw new SesEventError("SNS Message is not valid JSON.");
  }
  const m = msg as Partial<SesMessage> & { notificationType?: string };
  const eventType = m.eventType ?? m.notificationType;
  if (!eventType || typeof eventType !== "string") {
    throw new SesEventError("SES message has no eventType.");
  }
  if (!m.mail || typeof m.mail.messageId !== "string" || m.mail.messageId.length === 0) {
    throw new SesEventError("SES message has no mail.messageId.");
  }
  return { ...(m as SesMessage), eventType: eventType.toLowerCase() };
}

// ── Status transition matrix (pure, unit-tested) ────────────────

/**
 * email_status progress positions. NOTE: the schema deliberately has no
 * "opened"/"clicked" status — those exist only as email_event_type rows
 * (same model as Resend: status ends at delivered; engagement is events).
 */
type Progress = "created" | "queued" | "sending" | "sent" | "delivered";
const PROGRESS_RANK: Record<Progress, number> = {
  created: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
};
/** Terminal/authoritative: provider feedback never overrides these. */
const STICKY = new Set(["bounced", "complained", "failed", "suppressed"]);

export interface StatusTransition {
  /** New emails.status, or null when the event records only, no status change. */
  status: string | null;
  /** email_events row type to insert, or null to skip event recording. */
  eventType: string | null;
  /** Suppression to auto-insert ("bounce" | "complaint"), when warranted. */
  suppression: "bounce" | "complaint" | null;
  /** Recipient list the action applies to. */
  recipients: string[];
}

/**
 * The transition matrix. email_status is monotonic forward progress
 * (created < queued < sending < sent < delivered) so late/duplicated
 * deliveries never regress a row; sticky terminal states (bounced/
 * complained/failed/suppressed) are never overridden by happy-path
 * noise arriving later. opened/clicked are engagement events only —
 * the schema has no such status (Resend model). Transient bounces
 * record an event but never change status or suppress: SES keeps
 * retrying, and suppression on soft bounces would punish greylisting
 * and full inboxes.
 */
export function classifySesEvent(currentStatus: string, msg: SesMessage): StatusTransition {
  const none = {
    status: null,
    eventType: null,
    suppression: null as null,
    recipients: [] as string[],
  };
  const sticky = STICKY.has(currentStatus);
  const rank = (s: string) => (s in PROGRESS_RANK ? PROGRESS_RANK[s as Progress] : -1);

  switch (msg.eventType) {
    case "send":
      // We already recorded "sent" ourselves; nothing new.
      return { ...none };
    case "delivery": {
      const recipients = msg.delivery?.recipients ?? msg.mail.destination ?? [];
      const status = !sticky && rank(currentStatus) < 4 ? "delivered" : null;
      return { status, eventType: "delivered", suppression: null, recipients };
    }
    case "open":
      // Engagement is event-only: no opened/clicked status exists in the schema.
      return {
        status: null,
        eventType: "opened",
        suppression: null,
        recipients: msg.mail.destination ?? [],
      };
    case "click":
      return {
        status: null,
        eventType: "clicked",
        suppression: null,
        recipients: msg.mail.destination ?? [],
      };
    case "bounce": {
      const recipients = (msg.bounce?.bouncedRecipients ?? []).map((r) => r.emailAddress);
      const hard = (msg.bounce?.bounceType ?? "").toLowerCase() === "permanent";
      if (!hard) {
        // Transient bounce: record only. SES keeps retrying; suppression on
        // soft bounces would punish greylisting and full inboxes.
        return { ...none, eventType: "bounced", recipients };
      }
      return {
        status: sticky ? null : "bounced",
        eventType: "bounced",
        suppression: "bounce",
        recipients,
      };
    }
    case "complaint": {
      const recipients = (msg.complaint?.complainedRecipients ?? []).map((r) => r.emailAddress);
      return {
        status: currentStatus === "suppressed" ? null : "complained",
        eventType: "complained",
        suppression: "complaint",
        recipients,
      };
    }
    case "reject":
      return {
        status: sticky ? null : "failed",
        eventType: "failed",
        suppression: null,
        recipients: msg.mail.destination ?? [],
      };
    case "rendering failure":
      return {
        status: sticky ? null : "failed",
        eventType: "failed",
        suppression: null,
        recipients: msg.mail.destination ?? [],
      };
    default:
      return { ...none };
  }
}

// ── Application (durable) ───────────────────────────────────────

export interface ApplyResult {
  duplicate: boolean;
  unmatched: boolean;
  applied: boolean;
  emailId: string | null;
  status: string | null;
  suppressed: string[];
  eventId: string | null;
}

/**
 * Record + apply one verified SES notification. Idempotent end to end:
 * the provider_events row (unique on SNS MessageId) is inserted FIRST, so
 * SNS redelivery short-circuits before any state is touched twice.
 */
export async function applySesEvent(
  db: DbClient,
  env: SnsEnvelope,
  msg: SesMessage
): Promise<ApplyResult> {
  const { providerEvents, emails, emailEvents, suppressions } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");

  const eventRowId = `pev_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const inserted = await db
    .insert(providerEvents)
    .values({
      id: eventRowId,
      provider: "ses",
      snsMessageId: env.MessageId,
      sesMessageId: msg.mail.messageId,
      eventType: msg.eventType,
      payload: JSON.parse(env.Message) as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: providerEvents.snsMessageId })
    .returning({ id: providerEvents.id });

  if (inserted.length === 0) {
    return {
      duplicate: true,
      unmatched: false,
      applied: false,
      emailId: null,
      status: null,
      suppressed: [],
      eventId: null,
    };
  }

  // Join to our durable send record via the provider message id stamped at send.
  const [row] = await db
    .select({
      id: emails.id,
      projectId: emails.projectId,
      to: emails.to,
      status: emails.status,
    })
    .from(emails)
    .where(eq(emails.providerMessageId, msg.mail.messageId))
    .limit(1);

  if (!row) {
    // Unknown message id: keep the ledger row (forensics), flag unmatched,
    // and 200 so SNS does not redeliver someone else's traffic forever.
    await db
      .update(providerEvents)
      .set({ unmatched: true })
      .where(eq(providerEvents.id, eventRowId));
    return {
      duplicate: false,
      unmatched: true,
      applied: false,
      emailId: null,
      status: null,
      suppressed: [],
      eventId: eventRowId,
    };
  }

  const t = classifySesEvent(row.status, msg);
  const now = new Date();
  const suppressed: string[] = [];

  if (t.status) {
    await db
      .update(emails)
      .set({ status: t.status as never, updatedAt: now })
      .where(eq(emails.id, row.id));
  }
  if (t.eventType) {
    await db.insert(emailEvents).values({
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId: row.id,
      projectId: row.projectId,
      type: t.eventType as never,
      data: {
        source: "ses-feedback",
        snsMessageId: env.MessageId,
        ...(msg.bounce?.bounceType ? { bounceType: msg.bounce.bounceType } : {}),
        ...(msg.bounce?.bounceSubType ? { bounceSubType: msg.bounce.bounceSubType } : {}),
        ...(msg.delivery?.smtpResponse ? { smtpResponse: msg.delivery.smtpResponse } : {}),
        ...(msg.click?.link ? { link: msg.click.link } : {}),
        ...(msg.reject?.reason ? { reason: msg.reject.reason } : {}),
        ...(msg.complaint?.complaintFeedbackType
          ? { complaintFeedbackType: msg.complaint.complaintFeedbackType }
          : {}),
      },
    });
  }
  if (t.suppression) {
    for (const recipient of t.recipients) {
      const email = recipient.trim().toLowerCase();
      if (!email) continue;
      const ins = await db
        .insert(suppressions)
        .values({
          id: `sup_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          projectId: row.projectId,
          email,
          reason: t.suppression,
        })
        .onConflictDoNothing({ target: [suppressions.projectId, suppressions.email] })
        .returning({ id: suppressions.id });
      if (ins.length > 0) suppressed.push(email);
    }
  }

  await db
    .update(providerEvents)
    .set({ emailId: row.id, projectId: row.projectId, recipient: t.recipients[0] ?? row.to })
    .where(eq(providerEvents.id, eventRowId));

  return {
    duplicate: false,
    unmatched: false,
    applied: Boolean(t.status || t.eventType || suppressed.length > 0),
    emailId: row.id,
    status: t.status,
    suppressed,
    eventId: eventRowId,
  };
}
