/**
 * Prepaid capacity: monthly credit packs and daily burst passes.
 *
 * Invariants enforced here (the database is the authority, never the UI):
 *  - Included monthly allowance is consumed before purchased credits.
 *  - Credits are spent FIFO by expiry; a balance can never go negative.
 *  - One email consumes credits at most once, and can be released at most once
 *    (unique `(type, reference_id)` + row locks).
 *  - A burst pass adds daily capacity only; it never becomes monthly credits.
 *  - Fulfilment keyed by payment reference is idempotent.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import {
  CREDIT_EXPIRY_MONTHS,
  DAILY_BURST_PASS,
  creditExpiry,
  utcDayKey,
  type CreditPack,
} from "@calder/config";
import type { DbClient, DbExecutor } from "./client.js";
import { creditPurchases, creditTransactions, dailyBurstPasses } from "./schema/credits.js";
import { emails } from "./schema/emails.js";
import { projects } from "./schema/projects.js";

export interface CreditBalance {
  available: number;
  expiringSoon: Array<{ purchaseId: string; remaining: number; expiresAt: Date }>;
}

export async function creditBalance(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date()
): Promise<CreditBalance> {
  const rows = await db
    .select({
      id: creditPurchases.id,
      remaining: creditPurchases.creditsRemaining,
      expiresAt: creditPurchases.expiresAt,
    })
    .from(creditPurchases)
    .where(
      and(
        eq(creditPurchases.organizationId, organizationId),
        eq(creditPurchases.status, "active"),
        gt(creditPurchases.creditsRemaining, 0),
        gt(creditPurchases.expiresAt, now)
      )
    )
    .orderBy(asc(creditPurchases.expiresAt));
  return {
    available: rows.reduce((sum, row) => sum + row.remaining, 0),
    expiringSoon: rows.slice(0, 5).map((row) => ({
      purchaseId: row.id,
      remaining: row.remaining,
      expiresAt: row.expiresAt,
    })),
  };
}

/** Additional daily capacity from passes bought for today's UTC day. */
export async function activeBurstCapacity(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date()
): Promise<number> {
  const day = utcDayKey(now);
  const [row] = await db
    .select({ value: sql<number>`coalesce(sum(${dailyBurstPasses.additionalCapacity}), 0)` })
    .from(dailyBurstPasses)
    .where(
      and(
        eq(dailyBurstPasses.organizationId, organizationId),
        eq(dailyBurstPasses.utcDay, day),
        eq(dailyBurstPasses.status, "active"),
        gt(dailyBurstPasses.expiresAt, now)
      )
    );
  return Number(row?.value ?? 0);
}

export async function burstPassesToday(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date()
): Promise<number> {
  const day = utcDayKey(now);
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(dailyBurstPasses)
    .where(
      and(
        eq(dailyBurstPasses.organizationId, organizationId),
        eq(dailyBurstPasses.utcDay, day),
        eq(dailyBurstPasses.status, "active")
      )
    );
  return Number(row?.value ?? 0);
}

export interface CreditPurchaseResult {
  purchaseId: string;
  credits: number;
  expiresAt: Date;
  created: boolean;
}

/** Fulfil a verified payment for a monthly credit pack, exactly once. */
export async function fulfilCreditPurchase(
  db: DbClient,
  input: CreditPurchaseInput
): Promise<CreditPurchaseResult> {
  return db.transaction((tx) => fulfilCreditPurchaseInTx(tx, input));
}

export interface CreditPurchaseInput {
  organizationId: string;
  pack: CreditPack;
  paymentReference: string;
  purchasedAt?: Date;
}

/** Transaction-scoped variant so payment status + credits commit together. */
export async function fulfilCreditPurchaseInTx(
  tx: DbExecutor,
  input: CreditPurchaseInput
): Promise<CreditPurchaseResult> {
  const purchasedAt = input.purchasedAt ?? new Date();
  const expiresAt = creditExpiry(purchasedAt);
  const existing = await tx
    .select({
      id: creditPurchases.id,
      credits: creditPurchases.creditsPurchased,
      expiresAt: creditPurchases.expiresAt,
    })
    .from(creditPurchases)
    .where(eq(creditPurchases.paymentReference, input.paymentReference))
    .limit(1);
  if (existing[0]) {
    return {
      purchaseId: existing[0].id,
      credits: existing[0].credits,
      expiresAt: existing[0].expiresAt,
      created: false,
    };
  }
  const id = `crp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const inserted = await tx
    .insert(creditPurchases)
    .values({
      id,
      organizationId: input.organizationId,
      packId: input.pack.id,
      creditsPurchased: input.pack.credits,
      creditsRemaining: input.pack.credits,
      amountCents: input.pack.amountCents,
      currency: "USD",
      paymentReference: input.paymentReference,
      purchasedAt,
      expiresAt,
    })
    .onConflictDoNothing({ target: creditPurchases.paymentReference })
    .returning({ id: creditPurchases.id });
  if (!inserted[0]) {
    const [row] = await tx
      .select({
        id: creditPurchases.id,
        credits: creditPurchases.creditsPurchased,
        expiresAt: creditPurchases.expiresAt,
      })
      .from(creditPurchases)
      .where(eq(creditPurchases.paymentReference, input.paymentReference))
      .limit(1);
    if (!row) throw new Error("Credit purchase insert lost an idempotency race");
    return { purchaseId: row.id, credits: row.credits, expiresAt: row.expiresAt, created: false };
  }
  await tx.insert(creditTransactions).values({
    id: `ctx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    organizationId: input.organizationId,
    purchaseId: id,
    type: "purchase",
    amount: input.pack.credits,
    referenceId: input.paymentReference,
    description: `${input.pack.name}: ${input.pack.credits.toLocaleString()} emails`,
  });
  return { purchaseId: id, credits: input.pack.credits, expiresAt, created: true };
}

export interface CreditConsumption {
  consumed: number;
  allocations: Array<{ purchaseId: string; amount: number }>;
}

/**
 * Consume `units` from the oldest-expiring active purchases. Must run inside
 * the organization admission transaction; the conditional UPDATE guarantees a
 * concurrent request cannot overspend the same balance.
 */
export async function consumeCredits(
  db: DbExecutor,
  input: { organizationId: string; units: number; emailId?: string; now?: Date }
): Promise<CreditConsumption> {
  if (input.units <= 0) return { consumed: 0, allocations: [] };
  const now = input.now ?? new Date();
  const allocations: Array<{ purchaseId: string; amount: number }> = [];
  let remaining = input.units;

  const purchases = await db
    .select({ id: creditPurchases.id })
    .from(creditPurchases)
    .where(
      and(
        eq(creditPurchases.organizationId, input.organizationId),
        eq(creditPurchases.status, "active"),
        gt(creditPurchases.creditsRemaining, 0),
        gt(creditPurchases.expiresAt, now)
      )
    )
    .orderBy(asc(creditPurchases.expiresAt), asc(creditPurchases.purchasedAt));

  for (const purchase of purchases) {
    if (remaining <= 0) break;
    // One atomic statement per purchase: the CTE locks the row and computes
    // exactly how much it can give, so two concurrent reservations can never
    // both debit the same credits.
    const result = await db.execute(sql`
      with target as (
        select id, least(credits_remaining, ${remaining}) as take
          from credit_purchases
         where id = ${purchase.id}
           and status = 'active'
           and credits_remaining > 0
           and expires_at > ${now.toISOString()}::timestamptz
         for update
      )
      update credit_purchases p
         set credits_remaining = p.credits_remaining - target.take
        from target
       where p.id = target.id
       returning p.id as id, target.take as take, p.credits_remaining as remaining
    `);
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string;
      take: number;
      remaining: number;
    }>;
    const row = rows[0];
    if (!row || Number(row.take) <= 0) continue;
    const take = Number(row.take);
    allocations.push({ purchaseId: row.id, amount: take });
    remaining -= take;
  }

  if (remaining > 0) {
    // Roll back exactly what this request took; concurrent deductions are
    // untouched because every allocation is a concrete amount we debited.
    for (const allocation of allocations) {
      await db
        .update(creditPurchases)
        .set({ creditsRemaining: sql`${creditPurchases.creditsRemaining} + ${allocation.amount}` })
        .where(eq(creditPurchases.id, allocation.purchaseId));
    }
    throw new InsufficientCreditsError(input.units, input.units - remaining);
  }
  for (const allocation of allocations) {
    await db.insert(creditTransactions).values({
      id: `ctx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: input.organizationId,
      purchaseId: allocation.purchaseId,
      type: "consumption",
      amount: -allocation.amount,
      referenceId: input.emailId ?? null,
      description: `Email ${input.emailId ?? "(unspecified)"} used ${allocation.amount} prepaid credits`,
    });
  }
  return { consumed: input.units, allocations };
}

export class InsufficientCreditsError extends Error {
  readonly code = "insufficient_credits";
  constructor(
    readonly requested: number,
    readonly available: number
  ) {
    super(
      `Prepaid credits do not cover this send: ${requested} requested, ${available} available.`
    );
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Release credits after a definitive pre-provider failure. Idempotent: the
 * second attempt loses the unique `(release, emailId)` insert and changes
 * nothing.
 */
export async function releaseCredits(
  db: DbExecutor,
  input: { organizationId: string; emailId: string; reason: string }
): Promise<number> {
  const consumed = await db
    .select({
      purchaseId: creditTransactions.purchaseId,
      amount: sql<number>`sum(-${creditTransactions.amount})`,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.organizationId, input.organizationId),
        eq(creditTransactions.type, "consumption"),
        eq(creditTransactions.referenceId, input.emailId)
      )
    )
    .groupBy(creditTransactions.purchaseId);
  const total = consumed.reduce((sum, row) => sum + Number(row.amount), 0);
  if (total <= 0) return 0;
  const [already] = await db
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(
      and(eq(creditTransactions.type, "release"), eq(creditTransactions.referenceId, input.emailId))
    )
    .limit(1);
  if (already) return 0;
  await db.insert(creditTransactions).values({
    id: `ctx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    organizationId: input.organizationId,
    type: "release",
    amount: total,
    referenceId: input.emailId,
    description: `Released after definitive failure: ${input.reason}`,
  });
  for (const row of consumed) {
    if (!row.purchaseId) continue;
    await db
      .update(creditPurchases)
      .set({ creditsRemaining: sql`${creditPurchases.creditsRemaining} + ${Number(row.amount)}` })
      .where(eq(creditPurchases.id, row.purchaseId));
  }
  return total;
}

/**
 * Consume the credit portion of an admission decision inside the caller's
 * transaction. Returns 0 when the included allowance covers the request.
 */
export async function consumeAdmissionCredits(
  db: DbExecutor,
  input: {
    organizationId: string;
    emailId: string;
    decision: { creditUnits?: number | null };
    now?: Date;
  }
): Promise<number> {
  const units = Math.max(0, input.decision.creditUnits ?? 0);
  if (units === 0) return 0;
  const result = await consumeCredits(db, {
    organizationId: input.organizationId,
    units,
    emailId: input.emailId,
    ...(input.now ? { now: input.now } : {}),
  });
  return result.consumed;
}

/**
 * Release credits for an email that failed before any provider attempt.
 * Resolves the organization from the project so callers only pass the email id.
 */
export async function releaseCreditsForEmail(
  db: DbExecutor,
  input: { emailId: string; reason: string }
): Promise<number> {
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(emails)
    .innerJoin(projects, eq(emails.projectId, projects.id))
    .where(eq(emails.id, input.emailId))
    .limit(1);
  if (!row) return 0;
  return releaseCredits(db, {
    organizationId: row.organizationId,
    emailId: input.emailId,
    reason: input.reason,
  });
}

/** Expire unused credits. Safe to re-run; each purchase expires once. */
export async function expireCredits(db: DbExecutor, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({
      id: creditPurchases.id,
      organizationId: creditPurchases.organizationId,
      remaining: creditPurchases.creditsRemaining,
    })
    .from(creditPurchases)
    .where(
      and(
        eq(creditPurchases.status, "active"),
        lte(creditPurchases.expiresAt, now),
        gt(creditPurchases.creditsRemaining, 0)
      )
    );
  let expired = 0;
  for (const row of due) {
    await db
      .insert(creditTransactions)
      .values({
        id: `ctx_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        organizationId: row.organizationId,
        purchaseId: row.id,
        type: "expiry",
        amount: -row.remaining,
        referenceId: row.id,
        description: `${CREDIT_EXPIRY_MONTHS}-month expiry`,
      })
      .onConflictDoNothing();
    await db
      .update(creditPurchases)
      .set({ status: "expired", creditsRemaining: 0 })
      .where(eq(creditPurchases.id, row.id));
    expired++;
  }
  return expired;
}

export interface BurstPassResult {
  id: string;
  expiresAt: Date;
  created: boolean;
}

/** Fulfil a verified daily burst-pass payment, exactly once. */
export async function fulfilBurstPass(
  db: DbClient,
  input: BurstPassInput
): Promise<BurstPassResult> {
  return db.transaction((tx) => fulfilBurstPassInTx(tx, input));
}

export interface BurstPassInput {
  organizationId: string;
  paymentReference: string;
  now?: Date;
}

/** Transaction-scoped variant so payment status + pass commit together. */
export async function fulfilBurstPassInTx(
  tx: DbExecutor,
  input: BurstPassInput
): Promise<BurstPassResult> {
  const now = input.now ?? new Date();
  const day = utcDayKey(now);
  const expiresAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  const existing = await tx
    .select({ id: dailyBurstPasses.id, expiresAt: dailyBurstPasses.expiresAt })
    .from(dailyBurstPasses)
    .where(eq(dailyBurstPasses.paymentReference, input.paymentReference))
    .limit(1);
  if (existing[0]) {
    return { id: existing[0].id, expiresAt: existing[0].expiresAt, created: false };
  }
  const todays = await tx
    .select({ value: sql<number>`count(*)` })
    .from(dailyBurstPasses)
    .where(
      and(
        eq(dailyBurstPasses.organizationId, input.organizationId),
        eq(dailyBurstPasses.utcDay, day)
      )
    );
  if (Number(todays[0]?.value ?? 0) >= DAILY_BURST_PASS.maxPerUtcDay) {
    throw new BurstPassLimitError(DAILY_BURST_PASS.maxPerUtcDay);
  }
  const id = `dbp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const inserted = await tx
    .insert(dailyBurstPasses)
    .values({
      id,
      organizationId: input.organizationId,
      utcDay: day,
      additionalCapacity: DAILY_BURST_PASS.additionalCapacity,
      amountCents: DAILY_BURST_PASS.amountCents,
      paymentReference: input.paymentReference,
      purchasedAt: now,
      expiresAt,
    })
    .onConflictDoNothing({ target: dailyBurstPasses.paymentReference })
    .returning({ id: dailyBurstPasses.id });
  if (!inserted[0]) {
    const [row] = await tx
      .select({ id: dailyBurstPasses.id, expiresAt: dailyBurstPasses.expiresAt })
      .from(dailyBurstPasses)
      .where(eq(dailyBurstPasses.paymentReference, input.paymentReference))
      .limit(1);
    if (!row) throw new Error("Burst pass insert lost an idempotency race");
    return { id: row.id, expiresAt: row.expiresAt, created: false };
  }
  return { id, expiresAt, created: true };
}

export class BurstPassLimitError extends Error {
  readonly code = "burst_pass_limit";
  constructor(readonly maxPerDay: number) {
    super(`At most ${maxPerDay} Daily Burst Passes can be purchased per UTC day.`);
    this.name = "BurstPassLimitError";
  }
}

export interface CreditSnapshot {
  available: number;
  expiringSoon: CreditBalance["expiringSoon"];
  purchases: Array<{
    id: string;
    packId: string;
    creditsPurchased: number;
    creditsRemaining: number;
    amountCents: number;
    purchasedAt: Date;
    expiresAt: Date;
    status: string;
  }>;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    description: string | null;
    createdAt: Date;
  }>;
  burstCapacityToday: number;
  burstPassesToday: number;
  burstPassLimit: number;
}

export async function creditSnapshot(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date()
): Promise<CreditSnapshot> {
  const [balance, capacity, passes, purchases, transactions] = await Promise.all([
    creditBalance(db, organizationId, now),
    activeBurstCapacity(db, organizationId, now),
    burstPassesToday(db, organizationId, now),
    db
      .select()
      .from(creditPurchases)
      .where(eq(creditPurchases.organizationId, organizationId))
      .orderBy(asc(creditPurchases.purchasedAt))
      .limit(50),
    db
      .select({
        id: creditTransactions.id,
        type: creditTransactions.type,
        amount: creditTransactions.amount,
        description: creditTransactions.description,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.organizationId, organizationId))
      .orderBy(asc(creditTransactions.createdAt))
      .limit(50),
  ]);
  return {
    ...balance,
    purchases: purchases.map((p) => ({
      id: p.id,
      packId: p.packId,
      creditsPurchased: p.creditsPurchased,
      creditsRemaining: p.creditsRemaining,
      amountCents: p.amountCents,
      purchasedAt: p.purchasedAt,
      expiresAt: p.expiresAt,
      status: p.status,
    })),
    transactions,
    burstCapacityToday: capacity,
    burstPassesToday: passes,
    burstPassLimit: DAILY_BURST_PASS.maxPerUtcDay,
  };
}
