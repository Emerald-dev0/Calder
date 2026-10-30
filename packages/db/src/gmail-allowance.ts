import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, gte, isNull, min, or, sql } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { projectTransports } from "./schema/transports.js";
import { gmailSendAttempts } from "./schema/gmail-allowance.js";

export const GMAIL_DAILY_LIMIT = 100;
export const GMAIL_FIRST_DAY_LIMIT = 20;
const DAY = 24 * 60 * 60 * 1000;

function accountKey(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

export interface GmailAllowance {
  firstSendAt: Date | null;
  warmupEndsAt: Date | null;
  dailyResetAt: Date;
  used: number;
  limit: number;
  remaining: number;
}

/** A UTC calendar day; the first 24-hour period is anchored to first confirmed Google acceptance. */
async function snapshot(
  db: Pick<DbClient, "select">,
  hash: string,
  now: Date
): Promise<GmailAllowance> {
  const [first] = await db
    .select({ at: min(gmailSendAttempts.confirmedAt) })
    .from(gmailSendAttempts)
    .where(eq(gmailSendAttempts.accountHash, hash));
  const firstSendAt = first?.at ? new Date(first.at) : null;
  const warmupEndsAt = firstSendAt ? new Date(firstSendAt.getTime() + DAY) : null;
  const warmup = !warmupEndsAt || now < warmupEndsAt;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dailyResetAt = new Date(dayStart.getTime() + DAY);
  const windowStart = warmup && firstSendAt ? firstSendAt : dayStart;
  const [row] = await db
    .select({ value: count() })
    .from(gmailSendAttempts)
    .where(
      and(
        eq(gmailSendAttempts.accountHash, hash),
        or(isNull(gmailSendAttempts.confirmedAt), gte(gmailSendAttempts.confirmedAt, windowStart))
      )
    );
  const used = Number(row?.value ?? 0);
  const limit = warmup ? GMAIL_FIRST_DAY_LIMIT : GMAIL_DAILY_LIMIT;
  return {
    firstSendAt,
    warmupEndsAt,
    dailyResetAt,
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/** Caller must already have authorized access to the project. */
export async function gmailAllowanceForTransport(
  db: DbClient,
  projectId: string,
  transportId: string
): Promise<GmailAllowance | null> {
  const [transport] = await db
    .select({ label: projectTransports.label, dailyCap: projectTransports.dailyCap })
    .from(projectTransports)
    .where(
      and(
        eq(projectTransports.id, transportId),
        eq(projectTransports.projectId, projectId),
        eq(projectTransports.type, "gmail")
      )
    )
    .limit(1);
  if (!transport) return null;
  const allowance = await snapshot(db, accountKey(transport.label), new Date());
  allowance.limit = Math.min(allowance.limit, transport.dailyCap ?? GMAIL_DAILY_LIMIT);
  allowance.remaining = Math.max(0, allowance.limit - allowance.used);
  return allowance;
}

/** Atomically reserve one provider attempt across all projects and workers. */
export async function reserveGmailAttempt(
  db: DbClient,
  projectId: string,
  transportId: string
): Promise<string> {
  return db.transaction(async (tx) => {
    const [transport] = await tx
      .select({
        label: projectTransports.label,
        status: projectTransports.status,
        dailyCap: projectTransports.dailyCap,
      })
      .from(projectTransports)
      .where(
        and(
          eq(projectTransports.id, transportId),
          eq(projectTransports.projectId, projectId),
          eq(projectTransports.type, "gmail")
        )
      )
      .limit(1);
    if (!transport || transport.status !== "active")
      throw Object.assign(new Error("Gmail connection is unavailable."), {
        code: "sender_not_ready",
        transient: false,
      });
    const hash = accountKey(transport.label);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`);
    const [clock] = await tx.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
    const now = new Date(clock!.now);
    const allowance = await snapshot(tx, hash, now);
    const limit = Math.min(allowance.limit, transport.dailyCap ?? GMAIL_DAILY_LIMIT);
    if (allowance.used >= limit)
      throw Object.assign(new Error(`Gmail allowance reached (${allowance.used}/${limit}).`), {
        code: "gmail_cap",
        transient: false,
        statusCode: 429,
      });
    const id = randomUUID();
    await tx.insert(gmailSendAttempts).values({ id, accountHash: hash, attemptedAt: now });
    return id;
  });
}

/** Refuse to send, rather than falling back, if quota storage is unavailable. */
export async function enforceGmailAllowance(
  db: DbClient,
  projectId: string,
  transportId: string
): Promise<string> {
  try {
    return await reserveGmailAttempt(db, projectId, transportId);
  } catch (err) {
    if (
      err instanceof Error &&
      ["gmail_cap", "sender_not_ready"].includes((err as { code?: string }).code ?? "")
    )
      throw err;
    throw Object.assign(new Error("Gmail allowance unavailable; refusing delivery."), {
      code: "gmail_quota_unavailable",
      transient: true,
      statusCode: 503,
    });
  }
}

/** Settle under the same account lock as reservations. Unknown outcomes remain
 * reserved so an ambiguous send or process crash cannot bypass the cap. */
export async function settleGmailAttempt(
  db: DbClient,
  id: string,
  outcome: "accepted" | "rejected"
): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(gmailSendAttempts).where(eq(gmailSendAttempts.id, id));
    if (!entry) throw new Error("Gmail reservation missing.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${entry.accountHash}, 0))`);
    if (outcome === "accepted") {
      await tx
        .update(gmailSendAttempts)
        .set({ confirmedAt: sql`clock_timestamp()` })
        .where(and(eq(gmailSendAttempts.id, id), isNull(gmailSendAttempts.confirmedAt)));
    } else {
      await tx
        .delete(gmailSendAttempts)
        .where(and(eq(gmailSendAttempts.id, id), isNull(gmailSendAttempts.confirmedAt)));
    }
  });
}
