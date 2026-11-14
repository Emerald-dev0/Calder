import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getConfig } from "@calder/config";
import {
  checkInboundQuota,
  enqueueWebhookDeliveries,
  routeInboundMessage,
  INBOUND_MAX_ATTEMPTS,
  inboundAttachments,
  inboundMessages,
  organizationForProject,
  orgUsagePeriod,
  receivingDomainAccepts,
  receivingDomains,
  recordInboundUsage,
  type DbClient,
} from "@calder/db";
import { logger } from "@calder/observability";
import { AppError } from "../../errors/index.js";
import {
  domainOfAddress,
  parseInboundMime,
  type ParseLimits,
  type ParsedInbound,
} from "./parse.js";
import type { RawMessageStore } from "@calder/providers";

/**
 * Ingest one SES receipt notification.
 *
 * This is the only path that writes an inbound message, and it is written to be
 * safe under SNS's at-least-once delivery:
 *
 *   claim (unique ses_message_id) → quota → raw bytes → parse → store →
 *   meter → mark parsed
 *
 * Every step after the claim is idempotent or retryable. A message that fails
 * halfway is left in `failed` with a reason and a retry counter, so SNS's own
 * retry can complete it and an operator can see what happened. A duplicate
 * delivery of an already-processed message is a 200 with `duplicate: true` —
 * returning an error there would make SNS retry forever.
 *
 * Nothing here touches the outbound ledger: metering writes under
 * `inbound_emails`, and the quota it checks is the inbound allowance.
 */

export interface SesReceiptNotification {
  notificationType?: string;
  eventType?: string;
  mail: {
    messageId: string;
    timestamp?: string;
    source?: string;
    destination?: string[];
    commonHeaders?: { from?: string[]; to?: string[]; subject?: string; messageId?: string };
    headers?: Array<{ name: string; value: string }>;
  };
  receipt?: {
    recipients?: string[];
    spamVerdict?: { status?: string };
    virusVerdict?: { status?: string };
    spfVerdict?: { status?: string };
    dkimVerdict?: { status?: string };
    dmarcVerdict?: { status?: string };
    action?: {
      type?: string;
      bucketName?: string;
      objectKey?: string;
      topicArn?: string;
    };
  };
}

export type IngestResult =
  | { status: "stored"; messageId: string; duplicate: false; attachments: number }
  | { status: "duplicate"; messageId: string; duplicate: true }
  | { status: "rejected"; messageId: string; reason: string; duplicate: false }
  | { status: "ignored"; reason: string };

export class InboundIngestError extends AppError {
  constructor(message: string, status: 400 | 500 = 500) {
    super(status === 400 ? "validation_error" : "internal_error", message, status);
    this.name = "InboundIngestError";
  }
}

/** Parse the notification body, refusing anything that is not a receipt. */
export function parseReceiptNotification(messageJson: string): SesReceiptNotification {
  let body: unknown;
  try {
    body = JSON.parse(messageJson);
  } catch {
    throw new InboundIngestError("SNS Message is not valid JSON.", 400);
  }
  const n = body as Partial<SesReceiptNotification>;
  const type = (n.notificationType ?? n.eventType ?? "").toLowerCase();
  if (type !== "received") {
    throw new InboundIngestError(`Not a receipt notification (got "${type || "none"}").`, 400);
  }
  if (!n.mail || typeof n.mail.messageId !== "string" || n.mail.messageId.length === 0) {
    throw new InboundIngestError("Receipt notification has no mail.messageId.", 400);
  }
  return n as SesReceiptNotification;
}

/** The recipient address SES actually accepted mail for. */
export function primaryRecipient(n: SesReceiptNotification): string | null {
  const fromDestination = (n.mail.destination ?? []).find(
    (d) => typeof d === "string" && d.length > 0
  );
  if (fromDestination) return fromDestination.toLowerCase();
  const fromReceipt = (n.receipt?.recipients ?? []).find(
    (d) => typeof d === "string" && d.length > 0
  );
  return fromReceipt ? fromReceipt.toLowerCase() : null;
}

/**
 * Gate for every inbound route. A deployment that has not done the AWS work
 * answers 404 rather than accepting mail into a pipeline it cannot finish.
 */
export function requireInboundEnabled(): void {
  if (!getConfig().INBOUND_ENABLED) {
    throw new AppError("not_found", "Inbound email is not enabled on this deployment.", 404);
  }
}

export interface IngestDeps {
  db: DbClient;
  store: RawMessageStore;
  limits?: ParseLimits;
  now?: Date;
}

export async function ingestReceipt(
  deps: IngestDeps,
  input: { notification: SesReceiptNotification; snsMessageId?: string }
): Promise<IngestResult> {
  const { db, store } = deps;
  const now = deps.now ?? new Date();
  const notification = input.notification;

  // ── 1. Which of our domains is this for? ────────────────────────────────
  const recipients = (notification.mail.destination ?? []).map((d) => d.toLowerCase());
  const receipts = (notification.receipt?.recipients ?? []).map((d) => d.toLowerCase());
  const candidates = [...new Set([...recipients, ...receipts])];
  if (candidates.length === 0) {
    throw new InboundIngestError("Receipt notification has no recipients.", 400);
  }

  // Domain matching is exact: a receiving domain is a single DNS name, not a
  // suffix rule, so `sub.acme.com` never claims mail for `acme.com`.
  const domains = candidates.map((c) => domainOfAddress(c)).filter((d): d is string => Boolean(d));
  const rows = await db
    .select()
    .from(receivingDomains)
    .where(inArray(receivingDomains.domain, [...new Set(domains)]));

  const domain = rows.find((r) => candidates.some((c) => domainOfAddress(c) === r.domain));
  if (!domain) {
    // Not our mail (shared SES rule set, or a domain we no longer host). This
    // is not an error: acknowledge so SNS stops retrying.
    logger.warn(
      { recipients: candidates.slice(0, 5), sesMessageId: notification.mail.messageId },
      "inbound receipt for an unknown receiving domain ignored"
    );
    return { status: "ignored", reason: "unknown_recipient_domain" };
  }

  const acceptance = receivingDomainAccepts(domain);
  if (!acceptance.ok) {
    logger.warn(
      { receivingDomainId: domain.id, reason: acceptance.reason },
      "inbound receipt for a domain that is not accepting mail"
    );
    return { status: "ignored", reason: acceptance.reason };
  }

  const organizationId = await organizationForProject(db, domain.projectId);
  if (!organizationId) return { status: "ignored", reason: "project_missing" };

  const envelopeRecipient = candidates[0] ?? null;
  const receivedAt = parseTimestamp(notification.mail.timestamp) ?? now;
  const verdicts = {
    spamVerdict: notification.receipt?.spamVerdict?.status ?? null,
    virusVerdict: notification.receipt?.virusVerdict?.status ?? null,
    spfVerdict: notification.receipt?.spfVerdict?.status ?? null,
    dkimVerdict: notification.receipt?.dkimVerdict?.status ?? null,
    dmarcVerdict: notification.receipt?.dmarcVerdict?.status ?? null,
  };

  // ── 2. The claim. Unique ses_message_id makes redelivery a no-op. ────────
  const claimedId = `inb_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const inserted = await db
    .insert(inboundMessages)
    .values({
      id: claimedId,
      organizationId,
      projectId: domain.projectId,
      receivingDomainId: domain.id,
      recipientDomain: domain.domain,
      sesMessageId: notification.mail.messageId,
      snsMessageId: input.snsMessageId ?? null,
      envelopeFrom: notification.mail.source ?? null,
      envelopeRecipient,
      toAddresses: candidates,
      receivedAt,
      status: "received",
      ...verdicts,
    })
    .onConflictDoNothing({ target: inboundMessages.sesMessageId })
    .returning({ id: inboundMessages.id });

  let messageId: string;
  let attempts = 0;
  if (inserted.length === 0) {
    const [existing] = await db
      .select({
        id: inboundMessages.id,
        status: inboundMessages.status,
        processingAttempts: inboundMessages.processingAttempts,
      })
      .from(inboundMessages)
      .where(eq(inboundMessages.sesMessageId, notification.mail.messageId))
      .limit(1);
    if (!existing) {
      // Conflict but no row: a concurrent delete. Treat as retryable.
      throw new InboundIngestError("Inbound message disappeared after claim.", 500);
    }
    if (existing.status !== "failed" || existing.processingAttempts >= INBOUND_MAX_ATTEMPTS) {
      return { status: "duplicate", messageId: existing.id, duplicate: true };
    }
    messageId = existing.id;
    attempts = existing.processingAttempts;
    logger.info({ messageId, attempts }, "retrying failed inbound message");
  } else {
    messageId = inserted[0]!.id;
  }

  // ── 3. Quota, on the inbound allowance only. ────────────────────────────
  const quota = await checkInboundQuota(db, organizationId, now, 1);
  if (!quota.allowed) {
    await db
      .update(inboundMessages)
      .set({
        status: "rejected",
        failureReason: quota.message ?? "inbound allowance exhausted",
        processedAt: now,
        processingAttempts: attempts + 1,
      })
      .where(eq(inboundMessages.id, messageId));
    logger.warn(
      { organizationId, messageId, limit: quota.limit, received: quota.received },
      "inbound message rejected: workspace over its inbound allowance"
    );
    return { status: "rejected", messageId, reason: "inbound_quota_exhausted", duplicate: false };
  }

  // ── 4. Raw bytes, then parse. ───────────────────────────────────────────
  try {
    const objectKey = notification.receipt?.action?.objectKey;
    if (notification.receipt?.action?.type && notification.receipt.action.type !== "S3") {
      throw new Error(
        `SES receipt action is "${notification.receipt.action.type}", not S3: the receipt rule must store the message in S3 for us to read it.`
      );
    }
    if (!objectKey) {
      throw new Error(
        "Receipt notification has no S3 objectKey. The SES receipt rule must have an S3 action pointing at INBOUND_BUCKET."
      );
    }

    const raw = await store.get(objectKey);
    const cfg = getConfig();
    if (raw.byteLength > cfg.INBOUND_MAX_BYTES) {
      const reason = `Message is ${raw.byteLength} bytes, over the ${cfg.INBOUND_MAX_BYTES}-byte storage limit.`;
      await markFailed(db, messageId, attempts + 1, reason, now);
      return { status: "rejected", messageId, reason, duplicate: false };
    }

    const limits: ParseLimits = deps.limits ?? {
      maxBodyChars: cfg.INBOUND_MAX_BODY_CHARS,
      maxAttachmentBytes: 10 * 1024 * 1024,
      maxTotalAttachmentBytes: 20 * 1024 * 1024,
      maxAttachments: 50,
    };
    const parsed = await parseInboundMime(raw, limits);
    if (!parsed.ok) {
      // A message we cannot parse is not retryable: the bytes will not change.
      await markFailed(db, messageId, attempts + 1, `Could not parse MIME: ${parsed.reason}`, now);
      return { status: "rejected", messageId, reason: parsed.reason, duplicate: false };
    }

    const storedAttachments = await storeAttachments(deps, domain.projectId, messageId, parsed);
    const period = await orgUsagePeriod(db, organizationId, now);

    let routed: { inboxId: string | null; conversationId: string | null; started: boolean } = {
      inboxId: null,
      conversationId: null,
      started: false,
    };

    await db.transaction(async (tx) => {
      await tx
        .update(inboundMessages)
        .set({
          subject: parsed.subject,
          fromAddress: parsed.from?.address ?? null,
          fromName: parsed.from?.name ?? null,
          toAddresses: parsed.to.map((a) => a.address),
          ccAddresses: parsed.cc.map((a) => a.address),
          replyToAddresses: parsed.replyTo.map((a) => a.address),
          messageIdHeader: parsed.messageId,
          headers: parsed.headers,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          bodyTruncated: parsed.bodyTruncated,
          attachmentCount: storedAttachments,
          sizeBytes: raw.byteLength,
          rawStorageKey: objectKey,
          rawStoredAt: now,
          status: "parsed",
          failureReason: null,
          processedAt: now,
          processingAttempts: attempts + 1,
        })
        .where(eq(inboundMessages.id, messageId));

      // Metering lives in the same transaction as the body write: a message
      // that exists but is not on the ledger would let a workspace exceed its
      // allowance by racing retries.
      await recordInboundUsage(tx as unknown as DbClient, {
        organizationId,
        projectId: domain.projectId,
        inboundMessageId: messageId,
        period,
      });

      // Routing and threading in the same transaction: a message is never
      // "parsed but unthreaded", and a retry attaches to the same conversation
      // (conversation ids are derived from the message id).
      routed = await routeInboundMessage(tx as unknown as DbClient, {
        inboundMessageId: messageId,
        projectId: domain.projectId,
        organizationId,
        receivingDomainId: domain.id,
        envelopeRecipient,
        fromAddress: parsed.from?.address ?? null,
        toAddresses: [
          parsed.from?.address ?? "",
          ...parsed.to.map((a) => a.address),
          ...parsed.cc.map((a) => a.address),
        ].filter(Boolean),
        subject: parsed.subject,
        messageIdHeader: parsed.messageId,
        inReplyTo: parsed.headers["in-reply-to"] ?? null,
        references: parsed.headers["references"] ?? null,
        receivedAt,
      });
    });

    // Webhooks are best-effort: a delivery failure must never roll back a
    // message we have already accepted, and never make SNS retry a stored mail.
    try {
      await enqueueWebhookDeliveries(db, {
        projectId: domain.projectId,
        event: "inbound.received",
        data: {
          message_id: messageId,
          ses_message_id: notification.mail.messageId,
          from: parsed.from?.address ?? null,
          to: candidates,
          subject: parsed.subject,
          received_at: receivedAt.toISOString(),
          attachments: storedAttachments,
          inbox_id: routed.inboxId,
          conversation_id: routed.conversationId,
        },
      });
    } catch (err) {
      logger.warn({ err, messageId }, "inbound.received webhook could not be enqueued");
    }

    logger.info(
      { messageId, organizationId, attachments: storedAttachments, bytes: raw.byteLength },
      "inbound message stored"
    );
    return { status: "stored", messageId, duplicate: false, attachments: storedAttachments };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown ingest failure";
    await markFailed(db, messageId, attempts + 1, reason, now);
    logger.error({ err, messageId }, "inbound message processing failed");
    throw new InboundIngestError(`Inbound processing failed: ${reason}`, 500);
  }
}

async function markFailed(
  db: DbClient,
  messageId: string,
  attempts: number,
  reason: string,
  now: Date
): Promise<void> {
  await db
    .update(inboundMessages)
    .set({
      status: "failed",
      failureReason: reason,
      processingAttempts: attempts,
      processedAt: now,
    })
    .where(eq(inboundMessages.id, messageId));
}

/**
 * Store each kept attachment and insert its row. Returns the count stored.
 *
 * Attachment keys are derived from ids + part index, so a retry overwrites the
 * same object instead of littering the bucket; the unique (message, part) index
 * makes the row insert idempotent too.
 */
async function storeAttachments(
  deps: IngestDeps,
  projectId: string,
  messageId: string,
  parsed: ParsedInbound
): Promise<number> {
  if (parsed.attachments.length === 0) return 0;
  let stored = 0;

  for (const part of parsed.attachments) {
    let storageKey: string | null = null;
    if (part.content) {
      storageKey = deps.store.attachmentKey({ projectId, messageId, partIndex: part.partIndex });
      await deps.store.put(
        storageKey,
        part.content,
        part.contentType ?? "application/octet-stream"
      );
      stored += 1;
    }
    await deps.db
      .insert(inboundAttachments)
      .values({
        id: `att_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        inboundMessageId: messageId,
        partIndex: part.partIndex,
        filename: part.filename,
        contentType: part.contentType,
        sizeBytes: part.sizeBytes,
        contentId: part.contentId,
        disposition: part.disposition,
        storageKey,
        checksumSha256: part.checksumSha256,
      })
      .onConflictDoNothing({
        target: [inboundAttachments.inboundMessageId, inboundAttachments.partIndex],
      });
  }
  return stored;
}

function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Attachments belonging to one message, for download. Scoped by project so a
 * leaked message id from another workspace cannot be used to read bytes.
 */
export async function findAttachmentForDownload(
  db: DbClient,
  input: { projectId: string; messageId: string; attachmentId: string }
): Promise<{
  storageKey: string | null;
  filename: string | null;
  contentType: string | null;
} | null> {
  const [row] = await db
    .select({
      storageKey: inboundAttachments.storageKey,
      filename: inboundAttachments.filename,
      contentType: inboundAttachments.contentType,
    })
    .from(inboundAttachments)
    .innerJoin(inboundMessages, eq(inboundMessages.id, inboundAttachments.inboundMessageId))
    .where(
      and(
        eq(inboundAttachments.id, input.attachmentId),
        eq(inboundMessages.id, input.messageId),
        eq(inboundMessages.projectId, input.projectId)
      )
    )
    .limit(1);
  return row ?? null;
}
