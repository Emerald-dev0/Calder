import { and, desc, eq, gt, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { emailEvents, emails, suppressions, type DbClient } from "@calder/db";
import type { Cursor } from "../pagination";
import { looksLikeMessageId, rangeStart, UNATTRIBUTED_SENDER, type EmailFilters } from "./filters";
import { EXPORT_ROW_CAP } from "./csv";

/**
 * Reads for the message log.
 *
 * These live here rather than inline in the page and the export route so that
 * both, plus the cross-tenant test, run the *same* predicate. `projectId` is
 * always the first argument and always lands in the WHERE clause: there is no
 * code path that can read an email without naming the project it belongs to.
 *
 * Every function takes the drizzle client so a test can pass its own.
 */

/** The filter half of the predicate. Exported for the tenant-scope test. */
export function emailFilterWhere(projectId: string, filters: EmailFilters) {
  const start = rangeStart(filters.range);
  const q = filters.q.trim();

  return and(
    eq(emails.projectId, projectId),
    filters.stream === "all" ? undefined : eq(emails.stream, filters.stream),
    filters.status === "all" ? undefined : eq(emails.status, filters.status),
    start ? gte(emails.createdAt, start) : undefined,
    filters.sender === UNATTRIBUTED_SENDER
      ? isNull(emails.senderIdentityId)
      : filters.sender
        ? eq(emails.senderIdentityId, filters.sender)
        : undefined,
    filters.domain ? eq(sql`split_part(${emails.from}, '@', 2)`, filters.domain) : undefined,
    q
      ? or(
          ilike(emails.to, `%${q}%`),
          ilike(emails.subject, `%${q}%`),
          ilike(emails.providerMessageId, `%${q}%`),
          looksLikeMessageId(q) ? eq(emails.id, q) : undefined
        )
      : undefined
  );
}

const LIST_COLUMNS = {
  id: emails.id,
  to: emails.to,
  from: emails.from,
  subject: emails.subject,
  status: emails.status,
  stream: emails.stream,
  provider: emails.provider,
  createdAt: emails.createdAt,
} as const;

export interface EmailListRow {
  id: string;
  to: string;
  from: string;
  subject: string;
  status: string;
  stream: string;
  provider: string | null;
  createdAt: Date;
}

/**
 * Keyset predicate for the chosen direction.
 *
 * `newest` walks backwards (createdAt DESC, id DESC); `oldest` walks forwards.
 * Both are strict so a row is never returned twice across pages, and the id
 * tiebreak keeps messages created in the same millisecond ordered.
 */
function cursorAfter(cursor: Cursor | null, direction: "newest" | "oldest") {
  if (!cursor) return undefined;
  const cmp = direction === "newest" ? lt : gt;
  return or(
    cmp(emails.createdAt, cursor.createdAt),
    and(eq(emails.createdAt, cursor.createdAt), cmp(emails.id, cursor.id))
  );
}

/** One page of the log. Returns `limit` rows — caller probes for +1. */
export async function listEmails(
  db: DbClient,
  input: { projectId: string; filters: EmailFilters; cursor: Cursor | null; limit: number }
): Promise<EmailListRow[]> {
  const direction = input.filters.sort;
  const order =
    direction === "oldest"
      ? [emails.createdAt, emails.id]
      : [desc(emails.createdAt), desc(emails.id)];
  const rows = await db
    .select(LIST_COLUMNS)
    .from(emails)
    .where(
      and(emailFilterWhere(input.projectId, input.filters), cursorAfter(input.cursor, direction))
    )
    .orderBy(...order)
    .limit(input.limit);
  return rows;
}

/** The same filters, unpaginated for export and capped. */
export async function listEmailsForExport(
  db: DbClient,
  input: { projectId: string; filters: EmailFilters; limit?: number }
) {
  const cap = input.limit ?? EXPORT_ROW_CAP;
  const rows = await db
    .select({
      id: emails.id,
      to: emails.to,
      from: emails.from,
      subject: emails.subject,
      stream: emails.stream,
      status: emails.status,
      provider: emails.provider,
      providerMessageId: emails.providerMessageId,
      createdAt: emails.createdAt,
    })
    .from(emails)
    .where(emailFilterWhere(input.projectId, input.filters))
    .orderBy(
      ...(input.filters.sort === "oldest"
        ? [emails.createdAt, emails.id]
        : [desc(emails.createdAt), desc(emails.id)])
    )
    .limit(cap + 1);
  return { rows: rows.slice(0, cap), truncated: rows.length > cap, cap };
}

/**
 * The stream tabs' totals. Deliberately unfiltered beyond the project, so a tab
 * count does not shrink when the operator filters by status.
 */
export async function countEmailsByStream(db: DbClient, projectId: string) {
  const rows = await db
    .select({ stream: emails.stream, value: sql<number>`count(*)::int` })
    .from(emails)
    .where(eq(emails.projectId, projectId))
    .groupBy(emails.stream);
  const byStream = new Map(rows.map((r) => [r.stream, Number(r.value)]));
  const total = [...byStream.values()].reduce((a, b) => a + b, 0);
  return { byStream, total };
}

/** Distinct sender domains used by this project, for the domain filter. */
export async function listSenderDomains(db: DbClient, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ domain: sql<string>`split_part(${emails.from}, '@', 2)` })
    .from(emails)
    .where(eq(emails.projectId, projectId))
    .groupBy(sql`split_part(${emails.from}, '@', 2)`);
  return rows
    .map((r) => r.domain)
    .filter(Boolean)
    .sort();
}

export interface EmailDetail {
  message: {
    id: string;
    to: string;
    from: string;
    fromName: string | null;
    cc: string | null;
    bcc: string | null;
    replyTo: string | null;
    subject: string;
    html: string | null;
    text: string | null;
    status: string;
    stream: string;
    provider: string | null;
    providerMessageId: string | null;
    transport: string | null;
    env: string;
    lastError: string | null;
    attemptCount: number;
    idempotencyKey: string | null;
    scheduledFor: string | null;
    createdAt: string;
    updatedAt: string;
    metadata: unknown;
  };
  events: Array<{ id: string; type: string; data: unknown; createdAt: string }>;
  alreadySuppressed: boolean;
  templateName: string | null;
  apiKeyUsed: string | null;
}

/**
 * One message with its timeline, scoped to the project.
 *
 * An id that belongs to another tenant resolves to `null` — the WHERE names
 * both the id and the project, so the row is invisible rather than forbidden.
 */
export async function findEmailDetail(
  db: DbClient,
  projectId: string,
  id: string
): Promise<EmailDetail | null> {
  const [row] = await db
    .select()
    .from(emails)
    .where(and(eq(emails.id, id), eq(emails.projectId, projectId)))
    .limit(1);
  if (!row) return null;

  const events = await db
    .select({
      id: emailEvents.id,
      type: emailEvents.type,
      data: emailEvents.data,
      createdAt: emailEvents.createdAt,
    })
    .from(emailEvents)
    .where(and(eq(emailEvents.emailId, id), eq(emailEvents.projectId, projectId)))
    .orderBy(emailEvents.createdAt);

  const [suppressed] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.projectId, projectId), eq(suppressions.email, row.to.toLowerCase())))
    .limit(1);

  const metadata = (row.metadata ?? null) as Record<string, unknown> | null;
  const metaTemplate = metadata?.template;

  return {
    message: {
      id: row.id,
      to: row.to,
      from: row.from,
      fromName: row.fromName,
      cc: row.cc,
      bcc: row.bcc,
      replyTo: row.replyTo,
      subject: row.subject,
      html: row.html,
      text: row.text,
      status: row.status,
      stream: row.stream,
      provider: row.provider,
      providerMessageId: row.providerMessageId,
      transport: row.transport,
      env: row.env,
      lastError: row.lastError,
      attemptCount: row.attemptCount,
      idempotencyKey: row.idempotencyKey,
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      metadata: row.metadata,
    },
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      data: e.data,
      createdAt: e.createdAt.toISOString(),
    })),
    alreadySuppressed: Boolean(suppressed),
    // There is no template_id column on `emails`; the alias the send path used
    // rides in metadata when a send was template-based.
    templateName: typeof metaTemplate === "string" ? metaTemplate : null,
    apiKeyUsed: typeof metadata?.apiKeyId === "string" ? (metadata.apiKeyId as string) : null,
  };
}
