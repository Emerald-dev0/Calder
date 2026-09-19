import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { eq, and } from "drizzle-orm";
import {
  getDb,
  emails,
  emailEvents,
  suppressions,
  projectTransports,
  senderIdentities,
  type DbClient,
} from "@calder/db";
import { logger } from "@calder/observability";
import {
  createEmailService,
  pickDefaultTransport,
  GMAIL_FREE_DAILY_CAP,
  isProviderError,
} from "@calder/email";
import { GmailTransport, resolveEmailProvider } from "@calder/providers";
import { getGmailRefreshToken } from "@calder/auth";
import { isTransientError } from "@calder/queue";

export const DRAIN_BATCH = 25;
export const DRAIN_MAX_ATTEMPTS = 5;
/** A claimed ("sending") row abandoned mid-drain becomes claimable again after this window. */
export const DRAIN_STALE_CLAIM_MINUTES = 10;

/**
 * Delivery drain: the single implementation that turns persisted "queued"
 * rows into provider sends on serverless hosts (the queue has no
 * long-running consumer there; the worker deliverable is separate).
 *
 * Concurrency: rows are atomically claimed with
 *   UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
 * flipping them queued → sending in one statement. Overlapping drains
 * (scheduled tick + kickDrain wake-up, multiple invocations) each get a
 * disjoint set of rows, so one email can never be sent twice. Claims are
 * leases: a row stuck in "sending" (crashed mid-flight) becomes claimable
 * again after DRAIN_STALE_CLAIM_MINUTES.
 */

/** Row shape claimed for delivery (snake_case RETURNING aliased to camelCase). */
export type ClaimedEmail = {
  id: string;
  projectId: string;
  from: string;
  to: string;
  subject: string;
  html: string | null;
  text: string | null;
  metadata: Record<string, unknown> | null;
  attachments: Array<{ filename: string; contentType?: string; contentBase64: string }> | null;
  attemptCount: number;
  senderIdentityId: string | null;
} & Record<string, unknown>;

export interface DrainResult {
  ok: true;
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Provider selection is centralized in @calder/providers: a production deploy
 * without AWS credentials must fail loudly rather than simulate delivery.
 * Per-project transports (Gmail, SES) are chosen later in the drain loop.
 */
function getProvider() {
  return resolveEmailProvider().provider;
}

async function buildGmail(
  db: DbClient,
  projectId: string,
  chosen: {
    label: string;
    dailyCap: number | null;
    encryptedCredentials: { iv: string; ciphertext: string; tag: string } | null;
  }
) {
  const cap = chosen.dailyCap ?? GMAIL_FREE_DAILY_CAP;
  const { count, gte } = await import("drizzle-orm");
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sent = await db
    .select({ value: count() })
    .from(emails)
    .where(and(eq(emails.projectId, projectId), gte(emails.createdAt, dayStart)));
  const today = (sent[0] as { value: number } | undefined)?.value ?? 0;
  if (today >= cap) {
    throw Object.assign(
      new Error(`Gmail daily cap reached (${today}/${cap}). Add a domain to graduate.`),
      {
        code: "gmail_cap",
        transient: false,
        statusCode: 429,
      }
    );
  }
  if (!chosen.encryptedCredentials) {
    throw Object.assign(new Error("Gmail credentials missing."), {
      code: "sender_not_ready",
      transient: false,
      statusCode: 422,
    });
  }
  const refreshToken = getGmailRefreshToken(chosen.encryptedCredentials as never);
  return {
    service: createEmailService(
      new GmailTransport({ refreshToken, senderEmail: chosen.label }, chosen.dailyCap)
    ),
    transport: "gmail",
  };
}

async function resolveChain(db: DbClient, projectId: string, senderIdentityId: string | null) {
  const fallback = { service: createEmailService(getProvider()), transport: "default" };
  const chain: Array<{ service: ReturnType<typeof createEmailService>; transport: string }> = [];
  try {
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
        encryptedCredentials: r.encryptedCredentials as never,
        dailyCap: r.dailyCap,
        isDefault: r.isDefault,
      }))
    );
    if (senderIdentityId) {
      const [sender] = await db
        .select()
        .from(senderIdentities)
        .where(eq(senderIdentities.id, senderIdentityId))
        .limit(1);
      if (sender && sender.projectId === projectId) {
        if (sender.status !== "verified" && sender.status !== "connected") {
          throw Object.assign(new Error(`Sender ${sender.email} is ${sender.status}.`), {
            code: "sender_not_ready",
            transient: false,
            statusCode: 422,
          });
        }
        const linked = sender.transportId ? byId.get(sender.transportId) : undefined;
        if (linked && linked.status === "active" && (!def || linked.id !== def.id)) {
          if (linked.type === "gmail") chain.push(await buildGmail(db, projectId, linked as never));
          else chain.push({ service: createEmailService(getProvider()), transport: linked.type });
        }
      }
    }
    if (def && def.status === "active" && def.encryptedCredentials) {
      if (def.type === "gmail") chain.push(await buildGmail(db, projectId, def as never));
      else chain.push({ service: createEmailService(getProvider()), transport: def.type });
    }
  } catch (err) {
    if (
      (err instanceof Error && (err as { code?: string }).code === "gmail_cap") ||
      (err instanceof Error && (err as { code?: string }).code === "sender_not_ready")
    )
      throw err;
    logger.warn({ err }, "drain: transport resolution fallback");
  }
  chain.push(fallback);
  return chain;
}

/**
 * Atomically claim up to `limit` deliverable rows by flipping them to
 * "sending". Postgres' FOR UPDATE SKIP LOCKED guarantees two concurrent
 * drains never claim the same row; stale claims past the lease window are
 * re-claimable (crash recovery).
 */
export async function claimDrainBatch(
  db: DbClient,
  limit: number = DRAIN_BATCH,
  staleMinutes: number = DRAIN_STALE_CLAIM_MINUTES
): Promise<ClaimedEmail[]> {
  const claimed = await db.execute<ClaimedEmail>(sql`
    UPDATE emails
    SET status = 'sending', updated_at = now()
    WHERE id IN (
      SELECT id FROM emails
      WHERE
        (status = 'queued' AND (scheduled_for IS NULL OR scheduled_for <= now()))
        OR (status = 'sending' AND updated_at < now() - make_interval(mins => ${staleMinutes}))
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      project_id AS "projectId",
      "from",
      "to",
      subject,
      html,
      text,
      metadata,
      attachments,
      attempt_count AS "attemptCount",
      sender_identity_id AS "senderIdentityId"
  `);
  return claimed as unknown as ClaimedEmail[];
}

/**
 * Claim one batch and deliver it. Idempotent and safe to overlap with
 * itself: the claim lease makes row ownership exclusive.
 */
export async function drainPendingEmails(
  db: DbClient = getDb(),
  opts: { batch?: number } = {}
): Promise<DrainResult> {
  const now = new Date();
  const claimed = await claimDrainBatch(db, opts.batch ?? DRAIN_BATCH);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of claimed) {
    if ((row.attemptCount ?? 0) >= DRAIN_MAX_ATTEMPTS) {
      await db
        .update(emails)
        .set({ status: "failed", lastError: "Exhausted retries", updatedAt: now })
        .where(eq(emails.id, row.id));
      failed++;
      continue;
    }
    // Suppression check
    const sup = await db
      .select()
      .from(suppressions)
      .where(and(eq(suppressions.projectId, row.projectId), eq(suppressions.email, row.to)))
      .limit(1);
    if (sup.length > 0) {
      await db
        .update(emails)
        .set({ status: "suppressed", lastError: sup[0]!.reason, updatedAt: now })
        .where(eq(emails.id, row.id));
      await db.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "suppressed",
        data: { reason: sup[0]!.reason },
      });
      skipped++;
      continue;
    }

    // Claim attempt
    await db
      .update(emails)
      .set({ attemptCount: (row.attemptCount ?? 0) + 1, updatedAt: now })
      .where(eq(emails.id, row.id));

    const headers =
      typeof row.metadata === "object" &&
      row.metadata !== null &&
      typeof (row.metadata as Record<string, unknown>).headers === "object"
        ? ((row.metadata as Record<string, unknown>).headers as Record<string, string>)
        : {};
    const payload = {
      from: row.from,
      to: row.to,
      subject: row.subject,
      html: row.html ?? undefined,
      text: row.text ?? undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      attachments:
        Array.isArray(row.attachments) && row.attachments.length > 0
          ? (row.attachments as never)
          : undefined,
    };

    const chain = await resolveChain(db, row.projectId, row.senderIdentityId ?? null);
    let result: { providerMessageId: string; provider: string } | null = null;
    let transportName = "default";
    let lastErr: unknown = null;
    let isCap = false;
    let senderNotReady = false;
    for (let i = 0; i < chain.length; i++) {
      const leg = chain[i]!;
      try {
        const r = await leg.service.send(payload as never);
        result = r;
        transportName = leg.transport;
        break;
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && (err as { code?: string }).code === "gmail_cap") {
          isCap = true;
          break;
        }
        if (err instanceof Error && (err as { code?: string }).code === "sender_not_ready") {
          senderNotReady = true;
          break;
        }
        const transient = isProviderError(err)
          ? (err as { transient: boolean }).transient
          : isTransientError(err);
        const moreLegs = i < chain.length - 1;
        if (transient && moreLegs) continue;
        break;
      }
    }

    if (result) {
      const done = new Date();
      await db
        .update(emails)
        .set({
          status: "sent",
          providerMessageId: result.providerMessageId,
          transport: transportName,
          provider: result.provider,
          lastError: null,
          updatedAt: done,
        })
        .where(eq(emails.id, row.id));
      await db.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "sent",
        data: {
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          transport: transportName,
        },
      });
      sent++;
      continue;
    }

    // Failure path
    const transient = isTransientError(lastErr);
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (isCap || senderNotReady) {
      await db
        .update(emails)
        .set({ status: "failed", lastError: msg, updatedAt: new Date() })
        .where(eq(emails.id, row.id));
      await db.insert(emailEvents).values({
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "failed",
        data: { error: msg, transient: false },
      });
      failed++;
      continue;
    }
    if (transient && (row.attemptCount ?? 0) + 1 < DRAIN_MAX_ATTEMPTS) {
      // Release the claim back to the pool: row returns to "queued" for the
      // next tick instead of hanging on this drain's lease.
      await db
        .update(emails)
        .set({ status: "queued", lastError: msg, updatedAt: new Date() })
        .where(eq(emails.id, row.id));
      failed++;
      continue;
    }
    await db
      .update(emails)
      .set({ status: "failed", lastError: `Exhausted: ${msg}`, updatedAt: new Date() })
      .where(eq(emails.id, row.id));
    await db.insert(emailEvents).values({
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId: row.id,
      projectId: row.projectId,
      type: "failed",
      data: { error: msg, exhausted: true },
    });
    failed++;
  }

  return { ok: true, checked: claimed.length, sent, failed, skipped };
}
