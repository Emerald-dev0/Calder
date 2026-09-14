import { createQueue, type QueueJob } from "@calder/queue";
import { isTransientError, getRetryDelay } from "@calder/queue";
import { pickDefaultTransport, GMAIL_FREE_DAILY_CAP } from "@calder/email";
import { createEmailService, type EmailService } from "@calder/email";
import { GmailTransport, resolveEmailProvider } from "@calder/providers";
import { getGmailRefreshToken } from "@calder/auth";
import { logger, type Logger } from "@calder/observability";
import { randomUUID } from "node:crypto";

interface TransportCandidate {
  service: EmailService;
  /** Transport label recorded on the delivery (gmail/ses/managed/default). */
  transport: string;
}

function isCapError(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === "gmail_cap";
}

/**
 * Per-job transport chain. Sender preference first (the identity's own
 * transport), then the project default, then the global service. Transient
 * provider failures fall through to the next leg; cap rejections and dead
 * senders fail closed with a permanent, explainable error, never silently.
 */
async function resolveServiceChain(
  projectId: string,
  senderIdentityId: string | null,
  jobLogger: Logger
): Promise<TransportCandidate[]> {
  const fallback: TransportCandidate = {
    service: createEmailService(getProvider()),
    transport: "default",
  };
  const chain: TransportCandidate[] = [];
  try {
    const { getDb, projectTransports, senderIdentities } = await import("@calder/db");
    const { eq, and } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(projectTransports)
      .where(eq(projectTransports.projectId, projectId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const def = pickDefaultTransport(
      rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        type: r.type,
        status: r.status,
        label: r.label,
        encryptedCredentials: r.encryptedCredentials,
        dailyCap: r.dailyCap,
        isDefault: r.isDefault,
      }))
    );

    // Sender preference: the identity's own transport, when it is usable.
    // A disabled sender mid-flight fails closed, never silently reroutes.
    if (senderIdentityId) {
      const [sender] = await db
        .select()
        .from(senderIdentities)
        .where(eq(senderIdentities.id, senderIdentityId))
        .limit(1);
      if (sender && sender.projectId === projectId) {
        if (sender.status !== "verified" && sender.status !== "connected") {
          throw Object.assign(
            new Error(`Sender ${sender.email} is ${sender.status}. Re-enable it before sending.`),
            { code: "sender_not_ready", transient: false, statusCode: 422 }
          );
        }
        const linked = sender.transportId ? byId.get(sender.transportId) : undefined;
        if (linked && linked.status === "active" && (!def || linked.id !== def.id)) {
          if (linked.type === "gmail") {
            chain.push(await buildGmailService(db, projectId, linked, jobLogger));
          } else {
            chain.push({ service: createEmailService(getProvider()), transport: linked.type });
          }
        }
      }
    }

    if (def && def.status === "active" && def.encryptedCredentials) {
      if (def.type === "gmail") {
        const built = await buildGmailService(db, projectId, def, jobLogger);
        chain.push(built);
      } else {
        // ses/managed rows resolve through the global provider; the type is
        // what gets recorded, so delivery logs stay truthful.
        chain.push({ service: createEmailService(getProvider()), transport: def.type });
      }
    }
  } catch (err) {
    // Cap rejections and dead senders must surface, not silently fall back.
    if (
      isCapError(err) ||
      (err instanceof Error && (err as { code?: string }).code === "sender_not_ready")
    ) {
      throw err;
    }
    jobLogger.warn({ err }, "Transport resolution failed, using default provider");
  }
  chain.push(fallback);
  return chain;
}

async function buildGmailService(
  db: import("@calder/db").DbClient,
  projectId: string,
  chosen: {
    label: string;
    dailyCap: number | null;
    encryptedCredentials: { iv: string; ciphertext: string; tag: string } | null;
  },
  jobLogger: Logger
): Promise<TransportCandidate> {
  // Daily cap: count today's sends for this project (conservative, any transport).
  const cap = chosen.dailyCap ?? GMAIL_FREE_DAILY_CAP;
  const { emails } = await import("@calder/db");
  const { gte, and, count, eq } = await import("drizzle-orm");
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sent = await db
    .select({ value: count() })
    .from(emails)
    .where(and(eq(emails.projectId, projectId), gte(emails.createdAt, dayStart)));
  const today = (sent[0] as { value: number } | undefined)?.value ?? 0;
  if (today >= cap) {
    throw Object.assign(
      new Error(
        `Gmail daily cap reached (${today}/${cap}). Add a domain to graduate to production infrastructure.`
      ),
      { code: "gmail_cap", transient: false, statusCode: 429 }
    );
  }
  if (!chosen.encryptedCredentials) {
    throw Object.assign(new Error("Gmail credentials missing for transport."), {
      code: "sender_not_ready",
      transient: false,
      statusCode: 422,
    });
  }
  const refreshToken = getGmailRefreshToken(chosen.encryptedCredentials);
  const gmail = new GmailTransport({ refreshToken, senderEmail: chosen.label }, chosen.dailyCap);
  jobLogger.info({ transport: "gmail", sender: chosen.label }, "Routing via Gmail transport");
  return { service: createEmailService(gmail), transport: "gmail" };
}

interface EmailJobData {
  emailId: string;
  projectId: string;
}

function getProvider() {
  // Last-mile providers only. Internal (dogfood) mail enters upstream at
  // enqueue time, routing ALL jobs through a self-calling provider here
  // would recurse (worker → API → queue → worker). See docs/SYSTEM-EXPLAINED.md.
  const status = resolveEmailProvider();
  if (status.deliverable) {
    logger.info("Using SES email provider");
  } else {
    logger.warn({ reason: status.reason }, "Using mock email provider");
  }
  return status.provider;
}

export async function startWorker() {
  const defaultService = createEmailService(getProvider());

  // Shared queue, InMemory for scaffold; RedisQueue in production
  const queue = createQueue<EmailJobData>("email:send", { maxAttempts: 5 });

  queue.process(async (job: QueueJob<EmailJobData>) => {
    const { emailId, projectId } = job.data;
    const jobLogger = logger.child({
      jobId: job.id,
      emailId,
      projectId,
      attempt: job.attempts + 1,
    });

    jobLogger.info("Processing email job");

    try {
      // ── Load email (tenant-scoped) ─────────────────────────
      let email: {
        id: string;
        from: string;
        to: string;
        subject: string;
        html: string | null;
        text: string | null;
        status: string;
        headers: Record<string, string>;
        attachments: Array<{ filename: string; contentType?: string; contentBase64: string }>;
        senderIdentityId: string | null;
      } | null = null;

      try {
        const { getDb, emails } = await import("@calder/db");
        const { eq, and } = await import("drizzle-orm");
        const db = getDb();
        const rows = await db
          .select()
          .from(emails)
          .where(and(eq(emails.id, emailId), eq(emails.projectId, projectId)))
          .limit(1);
        const row = rows[0];
        if (row) {
          const atts = (row as { attachments?: unknown }).attachments;
          email = {
            id: row.id,
            from: row.from,
            to: row.to,
            subject: row.subject,
            html: row.html,
            text: row.text,
            status: row.status,
            senderIdentityId:
              (row as { senderIdentityId?: string | null }).senderIdentityId ?? null,
            headers:
              typeof row.metadata === "object" &&
              row.metadata !== null &&
              typeof (row.metadata as Record<string, unknown>).headers === "object"
                ? ((row.metadata as Record<string, unknown>).headers as Record<string, string>)
                : {},
            attachments: Array.isArray(atts)
              ? (atts as Array<{ filename: string; contentType?: string; contentBase64: string }>)
              : [],
          };
        }
      } catch (dbErr) {
        jobLogger.warn({ err: dbErr }, "DB lookup failed, trying in-memory fallback");
      }

      // ── Suppression check, before any provider call ────────
      // The cron drains perform this check; the worker is a separate
      // deliverable and must not be the path that mails someone who
      // bounced, complained or opted out. See the sending-path checklist
      // in AGENTS.md.
      if (email) {
        try {
          const { getDb, emails, emailEvents, suppressions } = await import("@calder/db");
          const { eq, and } = await import("drizzle-orm");
          const db = getDb();
          const sup = await db
            .select()
            .from(suppressions)
            .where(and(eq(suppressions.projectId, projectId), eq(suppressions.email, email.to)))
            .limit(1);
          if (sup.length > 0) {
            const now = new Date();
            await db
              .update(emails)
              .set({ status: "suppressed", lastError: sup[0]!.reason, updatedAt: now })
              .where(eq(emails.id, emailId));
            await db.insert(emailEvents).values({
              id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
              emailId,
              projectId,
              type: "suppressed",
              data: { reason: sup[0]!.reason, source: "worker" },
            });
            jobLogger.info({ reason: sup[0]!.reason }, "Recipient suppressed, not sending");
            return;
          }
        } catch (supErr) {
          // Never send on an unverifiable suppression state. Fail closed:
          // the queue retries, and a human sees the error.
          jobLogger.error({ err: supErr }, "Suppression check failed, refusing to send");
          throw supErr;
        }
      }

      // In-memory fallback for scaffold without DB (API's memoryEmails not shared across processes;
      // for single-process dev where API and worker share queue, we need to fetch via HTTP or shared store.
      // For scaffold vertical slice, if email not found in DB, we simulate with job data.
      // In production, email MUST exist in DB, this is a scaffold resilience fallback.
      if (!email) {
        jobLogger.warn("Email record not found in DB; using job data as fallback (scaffold mode)");
        // Create a synthetic email for mock provider to process, not persisted
        email = {
          id: emailId,
          from: "scaffold@calder.dev",
          to: "test@example.com",
          subject: "Scaffold test email",
          html: "<p>Hello from Calder scaffold</p>",
          text: "Hello from Calder scaffold",
          status: "queued",
          headers: {},
          attachments: [],
          senderIdentityId: null,
        };
        // Try to persist a fallback event anyway
      }

      // ── Resolve chain, then send with failover ─────────────
      // Sender's own transport first, then project default, then global.
      // Transient provider errors fall through to the next leg; caps and
      // dead senders throw immediately (fail closed, never silent).
      const chain = await resolveServiceChain(projectId, email.senderIdentityId, jobLogger);
      const payload = {
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html ?? undefined,
        text: email.text ?? undefined,
        headers: Object.keys(email.headers).length > 0 ? email.headers : undefined,
        attachments: email.attachments.length > 0 ? email.attachments : undefined,
      };
      const { isProviderError } = await import("@calder/email");
      let result: import("@calder/email").ProviderSendResult | null = null;
      let transportName = "default";
      let lastErr: unknown = null;
      for (let i = 0; i < chain.length; i++) {
        const leg = chain[i]!;
        try {
          result = await leg.service.send(payload);
          transportName = leg.transport;
          if (i > 0) jobLogger.info({ transport: transportName }, "Failover leg delivered");
          break;
        } catch (err) {
          lastErr = err;
          const transient = isProviderError(err) ? err.transient : false;
          const moreLegs = i < chain.length - 1;
          if (isCapError(err)) throw err;
          if (err instanceof Error && (err as { code?: string }).code === "sender_not_ready") {
            throw err;
          }
          if (transient && moreLegs) {
            jobLogger.warn(
              { err, transport: leg.transport },
              "Transient send failure, trying next transport leg"
            );
            continue;
          }
          throw err;
        }
      }
      if (!result)
        throw lastErr instanceof Error ? lastErr : new Error("All transport legs failed");

      jobLogger.info(
        {
          providerMessageId: result.providerMessageId,
          provider: result.provider,
          transport: transportName,
        },
        "Email sent via provider"
      );

      // ── Persist success event + update email status ─────────
      try {
        const { getDb, emails, emailEvents } = await import("@calder/db");
        const { eq } = await import("drizzle-orm");
        const db = getDb();
        await db
          .update(emails)
          .set({
            status: "sent",
            providerMessageId: result.providerMessageId,
            transport: transportName,
            provider: result.provider,
            updatedAt: new Date(),
          })
          .where(eq(emails.id, emailId));
        await db.insert(emailEvents).values({
          id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          emailId,
          projectId,
          type: "sent",
          data: { provider: result.provider, providerMessageId: result.providerMessageId },
        });
        // Also queue webhook delivery (async)
        await enqueueWebhookDelivery(projectId, emailId, "email.sent", {
          emailId,
          providerMessageId: result.providerMessageId,
        });
      } catch (persistErr) {
        jobLogger.error(
          { err: persistErr },
          "Failed to persist sent event, email was sent but event not recorded"
        );
        // Don't throw, provider succeeded; we log and continue. Event persistence will be retried via reconciliation.
      }
    } catch (err) {
      const transient = isTransientError(err);
      const attempt = job.attempts + 1;
      logger.error(
        { err, emailId, transient, attempt },
        `Email job failed (transient=${transient})`
      );

      if (!transient) {
        // Permanent failure, mark as failed, emit webhook, don't retry indefinitely
        try {
          const { getDb, emails, emailEvents } = await import("@calder/db");
          const { eq } = await import("drizzle-orm");
          const db = getDb();
          await db
            .update(emails)
            .set({ status: "failed", lastError: (err as Error).message, updatedAt: new Date() })
            .where(eq(emails.id, emailId));
          await db.insert(emailEvents).values({
            id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            emailId,
            projectId,
            type: "failed",
            data: { error: (err as Error).message, transient: false },
          });
          await enqueueWebhookDelivery(projectId, emailId, "email.failed", {
            emailId,
            error: (err as Error).message,
          });
        } catch (persistErr) {
          logger.error({ err: persistErr }, "Failed to persist failed event");
        }
        return; // don't rethrow, permanent failure handled
      }

      // Transient, if attempts remain, rethrow to trigger retry with backoff
      if (job.attempts + 1 < job.maxAttempts) {
        const delay = getRetryDelay(job.attempts);
        logger.info(
          { emailId, delayMs: delay, nextAttempt: job.attempts + 1 },
          "Retrying transient failure"
        );
        throw err; // queue will re-enqueue with backoff
      }

      // Exhausted, dead-letter
      logger.error(
        { emailId, attempts: job.maxAttempts },
        "Email job exhausted, moving to dead-letter"
      );
      try {
        const { getDb, emails, emailEvents } = await import("@calder/db");
        const { eq } = await import("drizzle-orm");
        const db = getDb();
        await db
          .update(emails)
          .set({
            status: "failed",
            lastError: `Exhausted after ${job.maxAttempts} attempts: ${(err as Error).message}`,
          })
          .where(eq(emails.id, emailId));
        await db.insert(emailEvents).values({
          id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          emailId,
          projectId,
          type: "failed",
          data: { error: (err as Error).message, exhausted: true },
        });
      } catch (persistErr) {
        logger.error({ err: persistErr }, "Failed to persist dead-letter");
      }
    }
  });

  logger.info("Worker consumer started on queue email:send");

  return queue;
}

async function enqueueWebhookDelivery(
  projectId: string,
  emailId: string,
  event: string,
  data: Record<string, unknown>
) {
  try {
    const { createQueue } = await import("@calder/queue");
    const q = createQueue("webhook:deliver", { maxAttempts: 8 });
    await q.enqueue("deliver-webhook", { projectId, emailId, event, data });
  } catch {
    // best-effort
  }
}
