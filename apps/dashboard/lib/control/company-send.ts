/**
 * The numbers behind a broadcast run, and how big a run is.
 *
 * Both the page (which has to tell an operator how many people are left before
 * they press anything) and the action (which has to actually send) need the same
 * answers. Keeping them in one place is the only way the number on the button and
 * the number of rows that move can agree.
 */

import { and, count, inArray, notInArray, sql } from "drizzle-orm";
import { companyEmails, users, type DbClient } from "@calder/db";
import { audienceWhere, type AudienceScope } from "./audience";

/**
 * How many recipients one request sends to.
 *
 * A provider call is a network round trip (and a database claim beside it), so
 * this is a duration budget, not a product limit. 150 × ~200 ms is comfortably
 * inside the segment's `maxDuration`; a slow provider still finishes. Override
 * with `COMPANY_BROADCAST_RUN_SIZE` when tuning, bounded so a typo cannot turn
 * one click into a thousand sequential sends.
 */
export function runSize(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.COMPANY_BROADCAST_RUN_SIZE);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 500) return configured;
  return 150;
}

/** How many of a set of user ids the audience scope actually contains. */
async function countOfIdsInScope(
  db: DbClient,
  scope: AudienceScope,
  selectedIds: string[],
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const scopeWhere = audienceWhere(scope, selectedIds);
  const idWhere = inArray(users.id, ids);
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(scopeWhere ? and(scopeWhere, idWhere) : idWhere);
  return Number(row?.n ?? 0);
}

export interface BatchProgress {
  /** Accounts the audience covers, ignoring what has already been mailed. */
  total: number;
  /** Accounts this exact batch has already reached (accepted or skipped). */
  alreadyMailed: number;
  /** Accounts still to reach. */
  remaining: number;
}

/**
 * Who this batch has reached, and who is left.
 *
 * "Reached" is read from `company_emails` rows for this batch key, so it is
 * evidence rather than a counter: a run interrupted halfway leaves the rows it
 * did write, and the next run picks up exactly after them.
 */
export async function batchProgress(
  db: DbClient,
  input: {
    scope: AudienceScope;
    selectedIds: string[];
    mailedIds: Set<string>;
  }
): Promise<BatchProgress> {
  const scopeWhere = audienceWhere(input.scope, input.selectedIds);
  const [row] = await db.select({ n: count() }).from(users).where(scopeWhere);
  const total = Number(row?.n ?? 0);
  const alreadyMailed = await countOfIdsInScope(db, input.scope, input.selectedIds, [
    ...input.mailedIds,
  ]);
  return { total, alreadyMailed, remaining: Math.max(0, total - alreadyMailed) };
}

/**
 * The recipients for the next run: in scope, not yet reached by this batch, in a
 * deterministic order so "the rest" is always the actual rest.
 */
export async function nextRecipients(
  db: DbClient,
  input: {
    scope: AudienceScope;
    selectedIds: string[];
    mailedIds: Set<string>;
    limit: number;
  }
): Promise<{ id: string; email: string; name: string | null; emailVerifiedAt: Date | null }[]> {
  const scopeWhere = audienceWhere(input.scope, input.selectedIds);
  const mailed = [...input.mailedIds];
  const notMailed = mailed.length > 0 ? notInArray(users.id, mailed) : undefined;
  const where = scopeWhere && notMailed ? and(scopeWhere, notMailed) : (scopeWhere ?? notMailed);

  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(where)
    .orderBy(users.createdAt, users.id)
    .limit(input.limit);
}

/** Company-email rows that are evidence of a real send, not a note to yourself. */
export function notOperatorTest() {
  return sql`coalesce(${companyEmails.metadata} ->> 'operatorTest', 'false') <> 'true'`;
}
