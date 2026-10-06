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
  recordSendUsage,
  type DbClient,
} from "@calder/db";
import { logger, safeDeliveryReason } from "@calder/observability";
import { isProduction } from "@calder/config";
import {
  createEmailService,
  pickDefaultTransport,
  GMAIL_FREE_DAILY_CAP,
  isProviderError,
  MockEmailProvider,
} from "@calder/email";
import { GmailTransport, resolveEmailProvider } from "@calder/providers";
import { getGmailRefreshToken } from "@calder/auth";
import { isTransientError } from "@calder/queue";

export const DRAIN_BATCH = 25;
export const DRAIN_MAX_ATTEMPTS = 5;

/** Postgres foreign-key violation. Exported for tests. */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23503";
}

/**
 * Insert a terminal email event, tolerating a parent row that vanished
 * mid-flight. Drains are global and rows are claimed across suites/processes,
 * while an organization delete cascades projects → emails → events: a row
 * claimed moments before its org was deleted (admin purge, retention, test
 * cleanup) must not abort the batch. The status UPDATEs above are already
 * safe (0-row no-ops); only inserts can throw. Returns false when skipped.
 */
export async function recordDrainEvent(
  db: DbClient,
  values: {
    id: string;
    emailId: string;
    projectId: string;
    type: "queued" | "sent" | "failed" | "suppressed";
    data: Record<string, unknown>;
  }
): Promise<boolean> {
  try {
    await db.insert(emailEvents).values(values);
    return true;
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      logger.warn(
        { emailId: values.emailId, type: values.type },
        "drain: parent email deleted mid-flight, skipping event"
      );
      return false;
    }
    throw err;
  }
}

/** Best-effort customer webhook for a queued send blocked by a current org pause. */
async function enqueueOrganizationBlockedWebhook(
  db: DbClient,
  projectId: string,
  emailId: string
): Promise<void> {
  try {
    const { enqueueWebhookDeliveries } = await import("@calder/db");
    await enqueueWebhookDeliveries(db, {
      projectId,
      event: "email.failed",
      data: {
        emailId,
        code: "organization_sending_unavailable",
        error: "Sending is currently unavailable for this organization.",
      },
    });
  } catch (err) {
    logger.warn({ err, emailId }, "drain: unable to enqueue organization-safety webhook");
  }
}

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
  /** Stamped at ingest from the API key's environment: "live" | "test". */
  env: string;
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
    id: string;
    label: string;
    dailyCap: number | null;
    encryptedCredentials: { iv: string; ciphertext: string; tag: string } | null;
  }
) {
  // M2.5 abuse watch first: limit/suspend verdicts are terminal for this
  // leg — they must surface like the cap, never silently degrade to SES.
  const { enforceGmailVelocity } = await import("@calder/db");
  await enforceGmailVelocity(db, projectId, { id: chosen.id, dailyCap: chosen.dailyCap });
  const cap = chosen.dailyCap ?? GMAIL_FREE_DAILY_CAP;
  const { count, gte } = await import("drizzle-orm");
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  // EXACT accounting: only sends that actually went through Gmail count
  // toward the Gmail cap (was: every transport, which let SES volume
  // exhaust a Gmail quota — the "overcounts" bug flagged in the audit).
  const sent = await db
    .select({ value: count() })
    .from(emails)
    .where(
      and(
        eq(emails.projectId, projectId),
        eq(emails.transport, "gmail"),
        gte(emails.createdAt, dayStart)
      )
    );
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
    transportId: chosen.id,
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
    // M2.5 abuse verdict is NOT a routing hint. A suspended transport means
    // "this project's Gmail sending is over until a real domain/transport is
    // connected" — falling through to the platform default here would move an
    // abuse-flagged project's mail onto Calder's own reputation silently,
    // which is the one thing the verdict must never do. Refuse loudly instead.
    // NB: check the RAW rows, not the picked default — pickDefaultTransport
    // only ever returns active rows, so a suspended default looks like "no
    // transport" and would silently land on the fallback leg.
    const suspendedDefault = rows.find(
      (r) => r.isDefault && r.type === "gmail" && r.status === "suspended"
    );
    if (suspendedDefault) {
      const { refuseSuspendedGmail } = await import("@calder/db");
      await refuseSuspendedGmail(db, projectId);
    }
    if (senderIdentityId) {
      const [sender] = await db
        .select()
        .from(senderIdentities)
        .where(
          and(eq(senderIdentities.id, senderIdentityId), eq(senderIdentities.projectId, projectId))
        )
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
        // Same rule for the sender's pinned leg: suspended refuses (no silent
        // hop to another identity's transport); revoked/error legs stay
        // skippable so recovery/failover keeps working.
        if (linked && linked.status === "suspended") {
          const { refuseSuspendedGmail } = await import("@calder/db");
          await refuseSuspendedGmail(db, projectId);
        }
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
    const code = err instanceof Error ? (err as { code?: string }).code : undefined;
    // Cap, abuse-watch verdicts and dead senders must surface, not silently
    // fall back — a swallowed "suspended" is a silent bulk path.
    if (
      code === "gmail_cap" ||
      code === "gmail_velocity_limit" ||
      code === "gmail_suspended" ||
      code === "sender_not_ready"
    )
      throw err;
    if (isProduction()) {
      // Hosted drain delivery must not cross the project/resource trust
      // boundary when its transport registry is unavailable. The row-level
      // failure path records a stable reason and retries transient errors.
      throw Object.assign(new Error("Transport resolution unavailable."), {
        code: "transport_resolution_failed",
        transient: true,
        statusCode: 503,
      });
    }
    logger.warn("drain: transport resolution unavailable; using development fallback");
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
      env,
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
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
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
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
      await recordDrainEvent(db, {
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "suppressed",
        data: { reason: sup[0]!.reason },
      });
      skipped++;
      continue;
    }

    // Organization status is re-read immediately before delivery (never cached).
    // Failed queue rows are terminal and never metered as provider-accepted.
    const { checkProjectSendingEligibility } = await import("@calder/db");
    const sendingDecision = await checkProjectSendingEligibility(db, row.projectId, {
      env: row.env === "test" ? "test" : "live",
      phase: "delivery",
      now,
    });
    if (!sendingDecision.allowed) {
      const message = "Sending is currently unavailable for this organization.";
      await db
        .update(emails)
        .set({ status: "failed", lastError: message, updatedAt: now })
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
      await recordDrainEvent(db, {
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "failed",
        data: { code: "organization_sending_unavailable" },
      });
      await enqueueOrganizationBlockedWebhook(db, row.projectId, row.id);
      failed++;
      continue;
    }

    // Claim attempt
    await db
      .update(emails)
      .set({ attemptCount: (row.attemptCount ?? 0) + 1, updatedAt: now })
      .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));

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

    // Test-env isolation (M2.3): test-key rows ALWAYS go through the mock
    // provider — never transports, never SES, even in a production deploy
    // with live AWS credentials. `provider: "mock"` on the delivery is the
    // durable proof; transport resolution never runs for these rows.
    //
    // Chain resolution can refuse the project outright (Gmail daily cap,
    // abuse-watch limit/suspend verdicts, dead sender). Those must surface —
    // never silently fail over to a cheaper transport — but they must surface
    // ON THE ROW: an error thrown past this loop would abort the whole batch,
    // leaving every other claimed row stuck in "sending" until the lease
    // expires and delaying legitimate mail by the full lease window.
    let chain: Awaited<ReturnType<typeof resolveChain>>;
    try {
      chain =
        row.env === "test"
          ? [
              {
                service: createEmailService(new MockEmailProvider({ latencyMs: 0 })),
                transport: "mock",
              },
            ]
          : await resolveChain(db, row.projectId, row.senderIdentityId ?? null);
    } catch (chainErr) {
      const code = safeDeliveryReason(chainErr);
      const transient =
        chainErr instanceof Error && (chainErr as { transient?: boolean }).transient === true;
      if (transient && (row.attemptCount ?? 0) + 1 < DRAIN_MAX_ATTEMPTS) {
        // Velocity limit: this leg is throttled, the mail itself is fine.
        // Release the claim back to the pool for a later tick.
        await db
          .update(emails)
          .set({ status: "queued", lastError: code, updatedAt: new Date() })
          .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
        logger.warn({ emailId: row.id, code }, "drain: chain refused transiently, requeued");
        failed++;
        continue;
      }
      await db
        .update(emails)
        .set({ status: "failed", lastError: code, updatedAt: new Date() })
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
      await recordDrainEvent(db, {
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "failed",
        data: { code, transient: false },
      });
      logger.warn({ emailId: row.id, code }, "drain: chain refused, row failed");
      failed++;
      continue;
    }
    let result: { providerMessageId: string; provider: string } | null = null;
    let transportName = "default";
    let lastErr: unknown = null;
    let isCap = false;
    let senderNotReady = false;
    let organizationUnavailable = false;
    for (let i = 0; i < chain.length; i++) {
      const leg = chain[i]!;
      try {
        // Fresh read for each provider leg closes stale state/cache bypasses,
        // including a suspension that lands while transport resolution runs.
        const currentSendingDecision = await checkProjectSendingEligibility(db, row.projectId, {
          env: row.env === "test" ? "test" : "live",
          phase: "delivery",
          now: new Date(),
        });
        if (!currentSendingDecision.allowed) {
          organizationUnavailable = true;
          lastErr = new Error("Sending is currently unavailable for this organization.");
          break;
        }
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
        // M2.4: revoked Gmail account — flip the transport once (audited),
        // then fail over to the next leg instead of failing mail forever.
        if (
          err instanceof Error &&
          (err as { code?: string }).code === "gmail_revoked" &&
          (leg as { transportId?: string }).transportId
        ) {
          try {
            const { markGmailRevoked } = await import("@calder/db");
            await markGmailRevoked(
              db,
              (leg as { transportId?: string }).transportId!,
              row.projectId
            );
            logger.warn(
              { transportId: (leg as { transportId?: string }).transportId },
              "Gmail account revoked; transport marked revoked, failing over"
            );
          } catch (markErr) {
            logger.error({ err: markErr }, "Failed to mark Gmail transport revoked");
          }
          if (i < chain.length - 1) continue;
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
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
      // Meter at provider-accept; exactly-once via deterministic ledger id
      // (ADR-036): retries and overlapping drains can never double-count.
      // Same mid-flight-deletion tolerance as recordDrainEvent: if the org
      // vanished under us, skip metering rather than aborting the batch.
      try {
        await recordSendUsage(db, {
          emailId: row.id,
          projectId: row.projectId,
          env: row.env ?? "live",
          when: done,
        });
      } catch (err) {
        if (!isForeignKeyViolation(err)) throw err;
        logger.warn({ emailId: row.id }, "drain: org deleted mid-flight, skipping usage");
      }
      await recordDrainEvent(db, {
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
    const reason = safeDeliveryReason(lastErr);
    if (isCap || senderNotReady || organizationUnavailable) {
      const terminalMessage = organizationUnavailable
        ? "Sending is currently unavailable for this organization."
        : reason;
      await db
        .update(emails)
        .set({ status: "failed", lastError: terminalMessage, updatedAt: new Date() })
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
      await recordDrainEvent(db, {
        id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        emailId: row.id,
        projectId: row.projectId,
        type: "failed",
        data: organizationUnavailable
          ? { code: "organization_sending_unavailable" }
          : { code: reason, transient: false },
      });
      if (organizationUnavailable) {
        await enqueueOrganizationBlockedWebhook(db, row.projectId, row.id);
      }
      failed++;
      continue;
    }
    if (transient && (row.attemptCount ?? 0) + 1 < DRAIN_MAX_ATTEMPTS) {
      // Release the claim back to the pool: row returns to "queued" for the
      // next tick instead of hanging on this drain's lease.
      await db
        .update(emails)
        .set({ status: "queued", lastError: reason, updatedAt: new Date() })
        .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
      failed++;
      continue;
    }
    await db
      .update(emails)
      .set({ status: "failed", lastError: `Exhausted: ${reason}`, updatedAt: new Date() })
      .where(and(eq(emails.id, row.id), eq(emails.projectId, row.projectId)));
    await recordDrainEvent(db, {
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId: row.id,
      projectId: row.projectId,
      type: "failed",
      data: { code: reason, exhausted: true },
    });
    failed++;
  }

  return { ok: true, checked: claimed.length, sent, failed, skipped };
}
