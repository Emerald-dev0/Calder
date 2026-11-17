/**
 * Turning the audience choice into rows.
 *
 * The page and the send action must agree about who a broadcast reaches, or the
 * number on the confirm checkbox is a guess. They also must agree about who has
 * already been mailed in this batch, because that is what lets a list larger
 * than one request be finished over several runs instead of being refused with
 * "split the audience" — an instruction this console never offered a way to
 * follow.
 *
 * So both call these functions. Everything DB-shaped about the audience lives
 * here; `audience.ts` stays pure and testable.
 */

import { and, count, eq, inArray, isNotNull, like } from "drizzle-orm";
import { companyEmails, users, type DbClient } from "@calder/db";
import { audienceWhere, type AudienceScope } from "./audience";

export interface MatchedRecipient {
  id: string;
  email: string;
  name: string | null;
  verified: boolean;
}

export interface SelectedResolution {
  matched: MatchedRecipient[];
  /** Addresses that belong to no account, in the order they were typed. */
  unmatched: string[];
}

/**
 * Resolve the named addresses to accounts.
 *
 * One query, matched case-insensitively (`users.email` is stored lowercased, and
 * an operator pasting from a CRM should not have to care). Unmatched addresses
 * come back so the page can name them: "4 of 6 matched" without the two names is
 * a number an operator cannot act on.
 */
export async function resolveSelectedUsers(
  db: DbClient,
  addresses: string[]
): Promise<SelectedResolution> {
  if (addresses.length === 0) return { matched: [], unmatched: [] };

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(inArray(users.email, addresses));

  const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row]));
  const matched: MatchedRecipient[] = [];
  const unmatched: string[] = [];

  for (const address of addresses) {
    const row = byEmail.get(address);
    if (!row) {
      unmatched.push(address);
      continue;
    }
    matched.push({
      id: row.id,
      email: row.email,
      name: row.name,
      verified: row.emailVerifiedAt !== null,
    });
  }

  return { matched, unmatched };
}

/**
 * The key that makes a batch one batch.
 *
 * Content-addressed and day-scoped: editing the copy produces a new batch,
 * re-clicking the same button does not. It is also the prefix of every
 * per-recipient idempotency key, which is what makes "who has this batch already
 * reached?" a query rather than a new table.
 */
export function batchKeyFor(
  template: string,
  subject: string,
  body: string,
  now: Date = new Date()
): string {
  const day = now.toISOString().slice(0, 10);
  const hash = Buffer.from(`${template}|${subject}|${body}|${day}`, "utf8").toString("base64url");
  return hash.slice(0, 40);
}

/** The per-recipient idempotency key, shared by the send and the exclusion query. */
export function recipientKeyFor(batch: string, userId: string): string {
  return `operator:${batch}:${userId}`;
}

/**
 * Users this batch has already reached — accepted or deliberately skipped.
 *
 * `failed` is excluded on purpose: a provider rejection is not a decision about
 * the person, and a rerun should try them again rather than quietly write them
 * off. Reading this from `company_emails` means the answer is evidence, not a
 * counter that can drift from what was actually sent.
 */
export async function mailedUserIds(db: DbClient, batch: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: companyEmails.userId })
    .from(companyEmails)
    .where(
      and(
        like(companyEmails.idempotencyKey, `operator:${batch}:%`),
        inArray(companyEmails.status, ["sent", "skipped"])
      )
    );

  const out = new Set<string>();
  for (const row of rows) if (row.userId) out.add(row.userId);
  return out;
}

/** How many accounts the whole scope covers, ignoring what has been mailed. */
export async function countInScope(
  db: DbClient,
  scope: AudienceScope,
  selectedIds: string[] = []
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(audienceWhere(scope, selectedIds));
  return Number(row?.n ?? 0);
}

/** How many accounts the scope covers, verified addresses only. */
export async function countVerifiedInScope(
  db: DbClient,
  scope: AudienceScope,
  selectedIds: string[] = []
): Promise<number> {
  const where = audienceWhere(scope, selectedIds);
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(where ? and(where, isNotNull(users.emailVerifiedAt)) : isNotNull(users.emailVerifiedAt));
  return Number(row?.n ?? 0);
}

/** Account totals, used by the page for the "who this run would reach" line. */
export async function audienceTotals(db: DbClient): Promise<{ verified: number; total: number }> {
  const [verified] = await db
    .select({ n: count() })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt));
  const [total] = await db.select({ n: count() }).from(users);
  return { verified: Number(verified?.n ?? 0), total: Number(total?.n ?? 0) };
}

/** One account by id — for the "send this person a test" path. */
export async function userById(db: DbClient, id: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}
