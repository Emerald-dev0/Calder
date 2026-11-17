import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import { getDb, inboundAttachments, inboundMessages, listInboundMessages } from "@calder/db";
import { logger } from "@calder/observability";
import type { Env } from "../app.js";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError } from "../errors/index.js";
import { planDisplayName } from "@calder/config";
import {
  isAllowedSnsUrl,
  parseSnsEnvelope,
  verifySnsSignature,
  SesEventError,
} from "../lib/ses-events.js";
import {
  InboundIngestError,
  findAttachmentForDownload,
  ingestReceipt,
  parseReceiptNotification,
  requireInboundEnabled,
} from "../lib/inbound/ingest.js";
import {
  getRawMessageStore,
  InboundObjectNotFound,
  InboundStorageNotConfigured,
} from "@calder/providers";

const inbound = new Hono<Env>();

/** Configured inbound topic allowlist. Empty = inbound ingress refuses everything. */
export function allowedInboundTopics(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.INBOUND_SNS_TOPIC_ARNS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * POST /v1/inbound/sns — SES receipt notifications.
 *
 * Same authenticity model as the delivery-feedback endpoint (SNS RSA signature,
 * certificate origin pinned to an SNS regional host) plus one deliberate
 * difference: the topic allowlist is **required**. Feedback events only ever
 * update rows that already exist, but an inbound notification *creates* a
 * message inside a customer's workspace — so a signed message from any AWS
 * account must not be enough.
 *
 * Idempotent by SES message id, so SNS redelivery is harmless. 500 on transient
 * failure so SNS retries; 400 only for a payload that will never parse.
 */
inbound.post("/sns", async (c) => {
  requireInboundEnabled();

  const topics = allowedInboundTopics();
  if (topics.length === 0) {
    logger.error("inbound SNS notification rejected: INBOUND_SNS_TOPIC_ARNS is not configured");
    return c.json(
      {
        error: {
          code: "not_configured",
          message:
            "INBOUND_SNS_TOPIC_ARNS is not configured, so inbound notifications are refused.",
        },
      },
      503
    );
  }

  // SNS posts JSON with Content-Type text/plain; always read raw text.
  const raw = await c.req.text();
  const envelope = parseSnsEnvelope(raw);
  await verifySnsSignature(envelope);

  if (!topics.includes(envelope.TopicArn)) {
    logger.warn(
      { topicArn: envelope.TopicArn },
      "inbound SNS event from a non-allowlisted topic rejected"
    );
    return c.json({ error: { code: "validation_error", message: "Topic not allowed." } }, 400);
  }

  if (envelope.Type === "SubscriptionConfirmation") {
    // Safe here because the topic is already allowlisted above.
    if (!envelope.SubscribeURL || !isAllowedSnsUrl(envelope.SubscribeURL)) {
      throw new SesEventError("SNS subscription URL is not an official SNS endpoint.");
    }
    const res = await fetch(envelope.SubscribeURL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.error(
        { status: res.status, topicArn: envelope.TopicArn },
        "SNS subscribe call failed"
      );
      throw new SesEventError("SNS subscribe call failed.", 500);
    }
    logger.info({ topicArn: envelope.TopicArn }, "inbound SNS subscription confirmed");
    return c.json({ ok: true, confirmed: true });
  }

  if (envelope.Type === "UnsubscribeConfirmation") {
    logger.warn({ topicArn: envelope.TopicArn }, "inbound SNS unsubscribe confirmation received");
    return c.json({ ok: true });
  }

  const notification = parseReceiptNotification(envelope.Message);

  try {
    const result = await ingestReceipt(
      { db: getDb(), store: getRawMessageStore() },
      { notification, snsMessageId: envelope.MessageId }
    );
    return c.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof InboundStorageNotConfigured) {
      // 500 on purpose: the message exists in S3 and SNS will retry, so a
      // configuration mistake becomes a retry storm rather than silent loss.
      logger.error({ err }, "inbound storage is not configured");
      return c.json(
        { error: { code: "inbound_storage_not_configured", message: err.message } },
        500
      );
    }
    if (err instanceof InboundIngestError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.status === 400 ? 400 : 500
      );
    }
    if (err instanceof SesEventError) throw err;
    logger.error({ err }, "inbound ingest failed");
    return c.json({ error: { code: "internal_error", message: "Inbound ingest failed." } }, 500);
  }
});

/* ── Reading received mail (API key auth, project-scoped) ─────────────────── */

function projectAuth(c: Context<Env>): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

/** GET /v1/inbound/messages — search and page this project's received mail. */
inbound.get("/messages", authMiddleware, async (c) => {
  requireInboundEnabled();
  const auth = projectAuth(c);
  requireScope(auth, "read");

  const q = c.req.query("q")?.trim() || undefined;
  const recipient = c.req.query("recipient")?.trim() || undefined;
  const limitParam = Number(c.req.query("limit") ?? "25");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 100)
    : 25;

  const since = parseDate(c.req.query("since"));
  const until = parseDate(c.req.query("until"));
  const cursor = parseCursor(c.req.query("cursor"));

  const { rows, nextCursor } = await listInboundMessages(getDb(), {
    projectId: auth.projectId,
    q,
    recipient,
    since,
    until,
    limit,
    cursor,
  });

  return c.json({
    data: rows.map((row) => ({
      id: row.id,
      received_at: row.receivedAt.toISOString(),
      status: row.status,
      from: row.fromAddress ? { address: row.fromAddress, name: row.fromName } : null,
      to: row.toAddresses,
      subject: row.subject,
      recipient_domain: row.recipientDomain,
      size_bytes: row.sizeBytes,
      attachment_count: row.attachmentCount,
      verdicts: { spam: row.spamVerdict, virus: row.virusVerdict },
    })),
    next_cursor: nextCursor,
  });
});

/** GET /v1/inbound/messages/:id — one message, including bodies and headers. */
inbound.get("/messages/:id", authMiddleware, async (c) => {
  requireInboundEnabled();
  const auth = projectAuth(c);
  requireScope(auth, "read");

  const db = getDb();
  const [row] = await db
    .select()
    .from(inboundMessages)
    .where(
      and(eq(inboundMessages.id, c.req.param("id")), eq(inboundMessages.projectId, auth.projectId))
    )
    .limit(1);
  // 404 for another project's message: the id is not a capability.
  if (!row) throw new AppError("not_found", "Message not found.", 404);

  const attachments = await db
    .select({
      id: inboundAttachments.id,
      filename: inboundAttachments.filename,
      contentType: inboundAttachments.contentType,
      sizeBytes: inboundAttachments.sizeBytes,
      contentId: inboundAttachments.contentId,
      disposition: inboundAttachments.disposition,
      stored: inboundAttachments.storageKey,
      checksum: inboundAttachments.checksumSha256,
    })
    .from(inboundAttachments)
    .where(eq(inboundAttachments.inboundMessageId, row.id));

  return c.json({
    data: {
      id: row.id,
      received_at: row.receivedAt.toISOString(),
      status: row.status,
      failure_reason: row.failureReason,
      envelope: { from: row.envelopeFrom, recipient: row.envelopeRecipient },
      from: row.fromAddress ? { address: row.fromAddress, name: row.fromName } : null,
      to: row.toAddresses,
      cc: row.ccAddresses,
      reply_to: row.replyToAddresses,
      subject: row.subject,
      message_id: row.messageIdHeader,
      headers: row.headers,
      body: { text: row.bodyText, html: row.bodyHtml, truncated: row.bodyTruncated },
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.contentType,
        size_bytes: a.sizeBytes,
        content_id: a.contentId,
        disposition: a.disposition,
        // False means we recorded the part but declined to store its bytes.
        stored: Boolean(a.stored),
        checksum_sha256: a.checksum,
      })),
      verdicts: {
        spam: row.spamVerdict,
        virus: row.virusVerdict,
        spf: row.spfVerdict,
        dkim: row.dkimVerdict,
        dmarc: row.dmarcVerdict,
      },
      size_bytes: row.sizeBytes,
    },
  });
});

/**
 * GET /v1/inbound/messages/:id/attachments/:attachmentId — stream one part.
 *
 * Streamed through the API rather than a presigned URL: the key never leaves
 * the server, the lookup is project-scoped, and a revoked API key stops working
 * immediately instead of at URL expiry. `X-Content-Type-Options: nosniff` plus
 * `Content-Disposition: attachment` keeps a hostile filename from executing.
 */
inbound.get("/messages/:id/attachments/:attachmentId", authMiddleware, async (c) => {
  requireInboundEnabled();
  const auth = projectAuth(c);
  requireScope(auth, "read");

  const attachment = await findAttachmentForDownload(getDb(), {
    projectId: auth.projectId,
    messageId: c.req.param("id"),
    attachmentId: c.req.param("attachmentId"),
  });
  if (!attachment) throw new AppError("not_found", "Attachment not found.", 404);
  if (!attachment.storageKey) {
    throw new AppError(
      "not_found",
      "This attachment was recorded but its contents were not stored (it exceeded the storage limit).",
      404
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await getRawMessageStore().get(attachment.storageKey);
  } catch (err) {
    if (err instanceof InboundObjectNotFound) {
      throw new AppError("not_found", "Attachment contents are no longer stored.", 404);
    }
    throw err;
  }

  const filename = sanitiseFilename(attachment.filename ?? "attachment");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.contentType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

/** GET /v1/inbound/usage — inbound allowance and storage, separate from sending. */
inbound.get("/usage", authMiddleware, async (c) => {
  requireInboundEnabled();
  const auth = projectAuth(c);
  requireScope(auth, "read");

  const {
    organizationForProject,
    organizationInboundStorage,
    organizationInboundUsage,
    planInboundStorageMb,
  } = await import("@calder/db");
  const db = getDb();
  const organizationId = await organizationForProject(db, auth.projectId);
  if (!organizationId) throw new AppError("not_found", "Project not found.", 404);

  const [usage, storage] = await Promise.all([
    organizationInboundUsage(db, organizationId),
    organizationInboundStorage(db, organizationId),
  ]);

  return c.json({
    data: {
      // Counted separately from outbound by construction: this reads the
      // inbound allowance and the inbound ledger only.
      inbound: {
        received: usage.received,
        limit: usage.limit,
        period_start: usage.period.start.toISOString(),
        period_end: usage.period.end.toISOString(),
        remaining: usage.limit === null ? null : Math.max(0, usage.limit - usage.received),
        tier: usage.tier,
        display_name: planDisplayName(usage.tier),
      },
      storage: {
        messages: storage.messages,
        attachments: storage.attachments,
        bytes: storage.bytes,
        limit_mb: planInboundStorageMb(usage.tier),
      },
    },
  });
});

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseCursor(value: string | undefined): { receivedAt: Date; id: string } | undefined {
  if (!value) return undefined;
  const [iso, id] = value.split("|");
  if (!iso || !id) return undefined;
  const receivedAt = new Date(iso);
  if (Number.isNaN(receivedAt.getTime())) return undefined;
  return { receivedAt, id };
}

/** Keep the filename printable and header-safe. */
export function sanitiseFilename(name: string): string {
  return (
    name
      .replace(/[\r\n"\\]/g, "_")
      .replace(/[^\x20-\x7e]/g, "_")
      .slice(0, 180) || "attachment"
  );
}

export default inbound;
