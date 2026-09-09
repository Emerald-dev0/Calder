import { createQueue, type QueueJob } from "@calder/queue";
import { isTransientError, getRetryDelay } from "@calder/queue";
import { MockEmailProvider, pickDefaultTransport, GMAIL_FREE_DAILY_CAP } from "@calder/email";
import { createEmailService, type EmailService } from "@calder/email";
import { SesEmailProvider, GmailTransport } from "@calder/providers";
import { getGmailRefreshToken } from "@calder/auth";
import { logger, type Logger } from "@calder/observability";
import { randomUUID } from "node:crypto";

/**
 * Per-job transport resolution. A project's active default transport
 * (e.g. connected Gmail) moves its mail; everything else uses the global
 * default service. Gmail sends are capped per UTC day and fail closed with a
 * permanent, explainable error, never silently, never over Google's limits.
 */
async function resolveEmailService(
 projectId: string,
 jobLogger: Logger
): Promise<{ service: EmailService; transport: string }> {
 const fallback = { service: createEmailService(getProvider()), transport: "default" };
 try {
 const { getDb, projectTransports } = await import("@calder/db");
 const { eq } = await import("drizzle-orm");
 const db = getDb();
 const rows = await db
 .select()
 .from(projectTransports)
 .where(eq(projectTransports.projectId, projectId));
 const chosen = pickDefaultTransport(
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
 if (!chosen || chosen.type !== "gmail" || !chosen.encryptedCredentials) return fallback;

 // Daily cap: count today's sends for this project (conservative, any transport).
 const cap = chosen.dailyCap ?? GMAIL_FREE_DAILY_CAP;
 const { emails } = await import("@calder/db");
 const { gte, and, count } = await import("drizzle-orm");
 const dayStart = new Date();
 dayStart.setUTCHours(0, 0, 0, 0);
 const sent = await db
 .select({ value: count() })
 .from(emails)
 .where(and(eq(emails.projectId, projectId), gte(emails.createdAt, dayStart)));
 const today = sent[0]?.value ?? 0;
 if (today >= cap) {
 throw Object.assign(
 new Error(
 `Gmail daily cap reached (${today}/${cap}). Add a domain to graduate to production infrastructure.`
 ),
 { code: "gmail_cap", transient: false, statusCode: 429 }
 );
 }

 const refreshToken = getGmailRefreshToken(chosen.encryptedCredentials);
 const gmail = new GmailTransport({ refreshToken, senderEmail: chosen.label }, chosen.dailyCap);
 jobLogger.info(
 { transport: "gmail", sender: chosen.label },
 "Routing via connected Gmail transport"
 );
 return { service: createEmailService(gmail), transport: "gmail" };
 } catch (err) {
 // Cap rejections and explicit denials must surface, not silently fall back.
 if (err instanceof Error && (err as { code?: string }).code === "gmail_cap") {
 throw err;
 }
 jobLogger.warn({ err }, "Transport resolution failed, using default provider");
 return fallback;
 }
}

interface EmailJobData {
 emailId: string;
 projectId: string;
}

function getProvider() {
 // Last-mile providers only. Internal (dogfood) mail enters upstream at
 // enqueue time, routing ALL jobs through a self-calling provider here
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
 email = {
 id: row.id,
 from: row.from,
 to: row.to,
 subject: row.subject,
 html: row.html,
 text: row.text,
 status: row.status,
 headers:
 typeof row.metadata === "object" &&
 row.metadata !== null &&
 typeof (row.metadata as Record<string, unknown>).headers === "object"
 ? ((row.metadata as Record<string, unknown>).headers as Record<string, string>)
 : {},
 };
 }
 } catch (dbErr) {
 jobLogger.warn({ err: dbErr }, "DB lookup failed, trying in-memory fallback");
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
 };
 // Try to persist a fallback event anyway
 }

 // ── Resolve transport, then send ───────────────────────
 // Project default transport wins (Gmail graduation path); otherwise the
 // global default service (SES if creds, else mock). Same events, same
 // meter, whichever moves the message.
 const { service: emailService, transport: transportName } = await resolveEmailService(
 projectId,
 jobLogger
 );
 const result = await emailService.send({
 from: email.from,
 to: email.to,
 subject: email.subject,
 html: email.html ?? undefined,
 text: email.text ?? undefined,
 headers: Object.keys(email.headers).length > 0 ? email.headers : undefined,
 });

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
