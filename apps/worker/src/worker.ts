import { createQueue, type QueueJob } from "@avenor/queue";
import { isTransientError, getRetryDelay } from "@avenor/queue";
import { MockEmailProvider } from "@avenor/email";
import { createEmailService } from "@avenor/email";
import { SesEmailProvider } from "@avenor/providers";
import { logger } from "@avenor/observability";
import { randomUUID } from "node:crypto";

interface EmailJobData {
  emailId: string;
  projectId: string;
}

function getProvider() {
  // Last-mile providers only. Internal (dogfood) mail enters upstream at
  // enqueue time — routing ALL jobs through a self-calling provider here
  // would recurse (worker → API → queue → worker). See docs/SYSTEM-EXPLAINED.md.
  // Use SES if AWS creds are present, otherwise mock
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    logger.info("Using SES email provider");
    return new SesEmailProvider();
  }
  logger.info("Using Mock email provider (set AWS_ACCESS_KEY_ID to use SES)");
  return new MockEmailProvider({ latencyMs: 100 });
}

export async function startWorker() {
  const provider = getProvider();
  const emailService = createEmailService(provider);

  // Shared queue — InMemory for scaffold; RedisQueue in production
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
      } | null = null;

      try {
        const { getDb, emails } = await import("@avenor/db");
        const { eq, and } = await import("drizzle-orm");
        const db = getDb();
        const rows = await db
          .select()
          .from(emails)
          .where(and(eq(emails.id, emailId), eq(emails.projectId, projectId)))
          .limit(1);
        const row = rows[0];
        if (row) {
          email = {
            id: row.id,
            from: row.from,
            to: row.to,
            subject: row.subject,
            html: row.html,
            text: row.text,
            status: row.status,
          };
        }
      } catch (dbErr) {
        jobLogger.warn({ err: dbErr }, "DB lookup failed, trying in-memory fallback");
      }

      // In-memory fallback for scaffold without DB (API's memoryEmails not shared across processes;
      // for single-process dev where API and worker share queue, we need to fetch via HTTP or shared store.
      // For scaffold vertical slice, if email not found in DB, we simulate with job data.
      // In production, email MUST exist in DB — this is a scaffold resilience fallback.
      if (!email) {
        jobLogger.warn("Email record not found in DB; using job data as fallback (scaffold mode)");
        // Create a synthetic email for mock provider to process — not persisted
        email = {
          id: emailId,
          from: "scaffold@avenor.dev",
          to: "test@example.com",
          subject: "Scaffold test email",
          html: "<p>Hello from Avenor scaffold</p>",
          text: "Hello from Avenor scaffold",
          status: "queued",
        };
        // Try to persist a fallback event anyway
      }

      // ── Send via provider ─────────────────────────────────
      const result = await emailService.send({
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html ?? undefined,
        text: email.text ?? undefined,
      });

      jobLogger.info(
        { providerMessageId: result.providerMessageId, provider: result.provider },
        "Email sent via provider"
      );

      // ── Persist success event + update email status ─────────
      try {
        const { getDb, emails, emailEvents } = await import("@avenor/db");
        const { eq } = await import("drizzle-orm");
        const db = getDb();
        await db
          .update(emails)
          .set({
            status: "sent",
            providerMessageId: result.providerMessageId,
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
          "Failed to persist sent event — email was sent but event not recorded"
        );
        // Don't throw — provider succeeded; we log and continue. Event persistence will be retried via reconciliation.
      }
    } catch (err) {
      const transient = isTransientError(err);
      const attempt = job.attempts + 1;
      logger.error(
        { err, emailId, transient, attempt },
        `Email job failed (transient=${transient})`
      );

      if (!transient) {
        // Permanent failure — mark as failed, emit webhook, don't retry indefinitely
        try {
          const { getDb, emails, emailEvents } = await import("@avenor/db");
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
        return; // don't rethrow — permanent failure handled
      }

      // Transient — if attempts remain, rethrow to trigger retry with backoff
      if (job.attempts + 1 < job.maxAttempts) {
        const delay = getRetryDelay(job.attempts);
        logger.info(
          { emailId, delayMs: delay, nextAttempt: job.attempts + 1 },
          "Retrying transient failure"
        );
        throw err; // queue will re-enqueue with backoff
      }

      // Exhausted — dead-letter
      logger.error(
        { emailId, attempts: job.maxAttempts },
        "Email job exhausted — moving to dead-letter"
      );
      try {
        const { getDb, emails, emailEvents } = await import("@avenor/db");
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
    const { createQueue } = await import("@avenor/queue");
    const q = createQueue("webhook:deliver", { maxAttempts: 8 });
    await q.enqueue("deliver-webhook", { projectId, emailId, event, data });
  } catch {
    // best-effort
  }
}
