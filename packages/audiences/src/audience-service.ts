import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  audiences,
  audienceContacts,
  contactImportJobs,
  contacts,
  type DbClient,
} from "@calder/db";
import { randomUUID } from "node:crypto";

/**
 * Audiences and contacts.
 *
 * Three rules the schema cannot enforce on its own, enforced here:
 *
 *  1. **An address is only ever added once.** Contacts are unique per
 *     (project, lowercased email); an add that already exists updates the name
 *     and properties instead of failing, because an import that stops at the
 *     first duplicate is useless.
 *  2. **A suppression is never overturned by an import.** A contact that is
 *     unsubscribed, bounced or complained stays that way; the row is counted
 *     in `skippedUnsubscribed` / `skippedBounced` / `skippedComplained` and the
 *     person is not re-added to the list. Winning back consent is a deliberate
 *     act (`consent-service`), not a side effect of uploading a file.
 *  3. **Importing requires an attestation.** `consentConfirmed` must be true;
 *     the database CHECK rejects anything else. Role addresses (info@,
 *     support@, sales@) are counted and skipped — mailing them is how a domain
 *     gets reported as spam.
 */

export type ConsentSource = "import" | "api" | "form" | "manual" | "double_opt_in";

export interface ContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  properties?: Record<string, unknown>;
}

export interface ImportCounts {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  skippedUnsubscribed: number;
  skippedBounced: number;
  skippedComplained: number;
  roleAddressRows: number;
  errorReport: { row: number; email: string; reason: string }[];
}

export const MAX_IMPORT_ROWS = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Addresses that belong to a team, not a person. Never mailable. */
const ROLE_LOCAL_PARTS = new Set([
  "info",
  "support",
  "sales",
  "admin",
  "administrator",
  "hello",
  "contact",
  "help",
  "billing",
  "accounts",
  "abuse",
  "postmaster",
  "hostmaster",
  "webmaster",
  "no-reply",
  "noreply",
  "donotreply",
  "do-not-reply",
  "office",
  "team",
  "marketing",
  "privacy",
  "legal",
  "jobs",
  "careers",
]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isMailableEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > 320) return false;
  if (!EMAIL_RE.test(email)) return false;
  if (email.includes("..")) return false;
  return true;
}

export function isRoleAddress(raw: string): boolean {
  const email = normalizeEmail(raw);
  const at = email.indexOf("@");
  if (at <= 0) return false;
  const local = email.slice(0, at).split("+")[0] ?? "";
  return ROLE_LOCAL_PARTS.has(local);
}

/** Minimal RFC 4180 reader: quotes, escaped quotes, CRLF, trailing newline. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, "email" | "firstName" | "lastName"> = {
  email: "email",
  "email address": "email",
  "e-mail": "email",
  mail: "email",
  "first name": "firstName",
  firstname: "firstName",
  "given name": "firstName",
  "last name": "lastName",
  lastname: "lastName",
  surname: "lastName",
  "family name": "lastName",
};

export interface ParsedContacts {
  rows: ContactInput[];
  invalid: number;
}

/**
 * Turn CSV text into contacts. The first row is a header when it names an
 * email column; otherwise every row is treated as `email, firstName, lastName`.
 * Unknown columns become `properties`, which is what segments filter on.
 */
export function contactsFromCsv(text: string): ParsedContacts {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], invalid: 0 };

  const header = table[0]!.map((cell) => cell.trim().toLowerCase());
  const hasHeader = header.some((cell) => HEADER_ALIASES[cell] === "email");
  const columns: Array<"email" | "firstName" | "lastName" | string> = hasHeader
    ? header.map((cell) => HEADER_ALIASES[cell] ?? cell)
    : ["email", "firstName", "lastName"];

  const body = hasHeader ? table.slice(1) : table;
  const rows: ContactInput[] = [];
  let invalid = 0;

  for (const cells of body) {
    const record: Record<string, string> = {};
    columns.forEach((column, index) => {
      const value = cells[index]?.trim();
      if (value) record[column] = value;
    });
    const email = record.email ?? cells[0] ?? "";
    if (!isMailableEmail(email)) {
      invalid++;
      continue;
    }
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "email" || key === "firstName" || key === "lastName") continue;
      properties[key] = value;
    }
    rows.push({
      email: normalizeEmail(email),
      firstName: record.firstName ?? null,
      lastName: record.lastName ?? null,
      properties,
    });
  }

  return { rows, invalid };
}

export async function createAudience(
  db: DbClient,
  input: {
    organizationId: string;
    projectId: string;
    name: string;
    description?: string | null;
    doubleOptIn?: boolean;
  }
) {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 255) {
    throw new Error("Audience name must be 1-255 characters.");
  }
  const [row] = await db
    .insert(audiences)
    .values({
      id: `aud_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      name,
      description: input.description?.trim() || null,
      doubleOptIn: input.doubleOptIn ?? false,
    })
    .returning();
  return row!;
}

export async function listAudiences(db: DbClient, projectId: string) {
  const rows = await db
    .select({
      id: audiences.id,
      name: audiences.name,
      description: audiences.description,
      doubleOptIn: audiences.doubleOptIn,
      createdAt: audiences.createdAt,
      archivedAt: audiences.archivedAt,
    })
    .from(audiences)
    .where(and(eq(audiences.projectId, projectId), isNull(audiences.archivedAt)))
    .orderBy(desc(audiences.createdAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      audienceId: audienceContacts.audienceId,
      status: audienceContacts.status,
      total: count(),
    })
    .from(audienceContacts)
    .where(
      inArray(
        audienceContacts.audienceId,
        rows.map((row) => row.id)
      )
    )
    .groupBy(audienceContacts.audienceId, audienceContacts.status);

  return rows.map((row) => {
    const mine = counts.filter((c) => c.audienceId === row.id);
    const by = (status: string) => Number(mine.find((c) => c.status === status)?.total ?? 0);
    return {
      ...row,
      total: mine.reduce((sum, c) => sum + Number(c.total), 0),
      subscribed: by("subscribed"),
      unsubscribed: by("unsubscribed"),
      pendingConfirmation: by("pending_confirmation"),
    };
  });
}

export async function getAudience(db: DbClient, projectId: string, audienceId: string) {
  const [row] = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.id, audienceId), eq(audiences.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

/**
 * Archive, never delete. A broadcast holds a RESTRICT foreign key to its
 * audience, so deletion is impossible once a list has been mailed; archiving
 * keeps the name available for reuse and the history readable.
 */
export async function archiveAudience(
  db: DbClient,
  projectId: string,
  audienceId: string
): Promise<boolean> {
  const [row] = await db
    .update(audiences)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(audiences.id, audienceId),
        eq(audiences.projectId, projectId),
        isNull(audiences.archivedAt)
      )
    )
    .returning({ id: audiences.id });
  return Boolean(row);
}

interface ExistingContact {
  id: string;
  email: string;
  status: string;
}

/**
 * Add contacts to an audience.
 *
 * Returns counters rather than throwing on the first bad row: an import of
 * 4,000 addresses with 12 malformed ones must still add the 3,988.
 */
export async function addContacts(
  db: DbClient,
  input: {
    organizationId: string;
    projectId: string;
    audienceId: string;
    contacts: ContactInput[];
    consentSource: ConsentSource;
    consentNote?: string | null;
  }
): Promise<ImportCounts> {
  const counts: ImportCounts = {
    totalRows: input.contacts.length,
    validRows: 0,
    duplicateRows: 0,
    invalidRows: 0,
    skippedUnsubscribed: 0,
    skippedBounced: 0,
    skippedComplained: 0,
    roleAddressRows: 0,
    errorReport: [],
  };

  // Deduplicate inside the payload first: the same address twice in one CSV is
  // one contact, and counting it twice would misreport the import.
  const byEmail = new Map<string, ContactInput>();
  for (const entry of input.contacts) {
    const email = normalizeEmail(entry.email);
    if (!isMailableEmail(email)) {
      counts.invalidRows++;
      counts.errorReport.push({
        row: counts.validRows + counts.invalidRows,
        email: entry.email,
        reason: "invalid_address",
      });
      continue;
    }
    if (isRoleAddress(email)) {
      counts.roleAddressRows++;
      counts.errorReport.push({
        row: counts.validRows + counts.roleAddressRows,
        email,
        reason: "role_address",
      });
      continue;
    }
    if (byEmail.has(email)) {
      counts.duplicateRows++;
      continue;
    }
    byEmail.set(email, { ...entry, email });
  }

  const emails = [...byEmail.keys()];
  if (emails.length === 0) return counts;

  // Existing contacts, so an import can tell "new" from "already here" and
  // respect a state the person chose.
  const existing: ExistingContact[] = await db
    .select({ id: contacts.id, email: contacts.email, status: contacts.status })
    .from(contacts)
    .where(and(eq(contacts.projectId, input.projectId), inArray(contacts.email, emails)));
  const existingByEmail = new Map(existing.map((row) => [row.email, row]));

  for (const [email, entry] of byEmail) {
    const current = existingByEmail.get(email);
    if (current) {
      if (current.status === "unsubscribed") {
        counts.skippedUnsubscribed++;
        counts.errorReport.push({ row: 0, email, reason: "previously_unsubscribed" });
        continue;
      }
      if (current.status === "bounced") {
        counts.skippedBounced++;
        counts.errorReport.push({ row: 0, email, reason: "previously_bounced" });
        continue;
      }
      if (current.status === "complained") {
        counts.skippedComplained++;
        counts.errorReport.push({ row: 0, email, reason: "previously_complained" });
        continue;
      }
      counts.duplicateRows++;
      await db
        .update(contacts)
        .set({
          firstName: entry.firstName ?? null,
          lastName: entry.lastName ?? null,
          properties: entry.properties ?? {},
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, current.id));
    } else {
      counts.validRows++;
      await db.insert(contacts).values({
        id: `ct_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        email,
        firstName: entry.firstName ?? null,
        lastName: entry.lastName ?? null,
        properties: entry.properties ?? {},
        status: "subscribed",
        consentSource: input.consentSource,
        consentAt: new Date(),
        consentNote: input.consentNote ?? null,
      });
    }
  }

  // Membership. `onConflictDoNothing` makes re-adding somebody idempotent and
  // never resurrects a membership that was explicitly unsubscribed.
  const all = await db
    .select({ id: contacts.id, email: contacts.email, status: contacts.status })
    .from(contacts)
    .where(and(eq(contacts.projectId, input.projectId), inArray(contacts.email, emails)));

  const members = all
    .filter((row) => row.status === "subscribed")
    .map((row) => ({
      audienceId: input.audienceId,
      contactId: row.id,
      status: "subscribed" as const,
    }));

  if (members.length > 0) {
    await db.insert(audienceContacts).values(members).onConflictDoNothing();
  }

  return counts;
}

/** Import a CSV body into an audience and record the job that did it. */
export async function importCsv(
  db: DbClient,
  input: {
    organizationId: string;
    projectId: string;
    audienceId: string;
    csv: string;
    fileName?: string | null;
    createdBy?: string | null;
    consentConfirmed: boolean;
  }
): Promise<{ jobId: string; counts: ImportCounts }> {
  // The database CHECK enforces this too; failing here gives a usable message
  // instead of a constraint violation surfacing as a 500.
  if (!input.consentConfirmed) {
    throw new Error(
      "Importing requires an explicit confirmation that these contacts gave permission to be mailed."
    );
  }

  const jobId = `imp_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const startedAt = new Date();
  await db.insert(contactImportJobs).values({
    id: jobId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    audienceId: input.audienceId,
    createdBy: input.createdBy ?? null,
    status: "processing",
    fileName: input.fileName?.slice(0, 255) ?? null,
    consentConfirmed: true,
    startedAt,
  });

  const parsed = contactsFromCsv(input.csv);
  const counts =
    parsed.rows.length > MAX_IMPORT_ROWS
      ? await addContacts(db, {
          ...input,
          contacts: parsed.rows.slice(0, MAX_IMPORT_ROWS),
          consentSource: "import",
        })
      : await addContacts(db, {
          ...input,
          contacts: parsed.rows,
          consentSource: "import",
        });
  counts.invalidRows += parsed.invalid;

  await db
    .update(contactImportJobs)
    .set({
      status: "completed",
      totalRows: counts.totalRows + parsed.invalid,
      validRows: counts.validRows,
      duplicateRows: counts.duplicateRows,
      invalidRows: counts.invalidRows,
      skippedUnsubscribed: counts.skippedUnsubscribed,
      skippedBounced: counts.skippedBounced,
      skippedComplained: counts.skippedComplained,
      roleAddressRows: counts.roleAddressRows,
      errorReport: {
        rows: counts.errorReport.slice(0, 500).map((row) => ({
          row: row.row,
          email: row.email,
          error: row.reason,
        })),
      },
      completedAt: new Date(),
    })
    .where(eq(contactImportJobs.id, jobId));

  return { jobId, counts };
}

export async function listAudienceContacts(
  db: DbClient,
  audienceId: string,
  opts: { limit?: number; status?: "subscribed" | "unsubscribed" | "pending_confirmation" } = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.status
    ? and(eq(audienceContacts.audienceId, audienceId), eq(audienceContacts.status, opts.status))
    : eq(audienceContacts.audienceId, audienceId);

  const rows = await db
    .select({
      contactId: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      status: audienceContacts.status,
      subscribedAt: audienceContacts.subscribedAt,
    })
    .from(audienceContacts)
    .innerJoin(contacts, eq(audienceContacts.contactId, contacts.id))
    .where(where)
    .orderBy(desc(audienceContacts.subscribedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  return { data: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/** Counts used by the broadcast materialiser and the dashboard. */
export async function audienceStats(db: DbClient, audienceId: string) {
  const rows = await db
    .select({ status: audienceContacts.status, total: count() })
    .from(audienceContacts)
    .where(eq(audienceContacts.audienceId, audienceId))
    .groupBy(audienceContacts.status);
  const by = (status: string) => Number(rows.find((r) => r.status === status)?.total ?? 0);
  return {
    subscribed: by("subscribed"),
    unsubscribed: by("unsubscribed"),
    pendingConfirmation: by("pending_confirmation"),
    total: rows.reduce((sum, r) => sum + Number(r.total), 0),
  };
}

/** Postgres `ilike` search across the contacts of one audience. */
export async function searchAudienceContacts(
  db: DbClient,
  audienceId: string,
  query: string,
  limit = 50
) {
  const pattern = `%${query.replace(/[%_]/g, "")}%`;
  return db
    .select({
      contactId: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      status: audienceContacts.status,
    })
    .from(audienceContacts)
    .innerJoin(contacts, eq(audienceContacts.contactId, contacts.id))
    .where(
      and(eq(audienceContacts.audienceId, audienceId), sql`${contacts.email} ILIKE ${pattern}`)
    )
    .limit(Math.min(Math.max(limit, 1), 200));
}
