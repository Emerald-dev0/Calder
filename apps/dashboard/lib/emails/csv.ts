/**
 * CSV serialisation for the message log export.
 *
 * Two things this must get right beyond quoting:
 *
 *  1. A row cap. "Export" on an unbounded filter would otherwise try to stream
 *     a customer's entire history through a server action.
 *  2. Formula injection. A subject line is attacker-controlled (the sender
 *     writes it, but a bounce report can echo it back). A cell starting with
 *     `=`, `+`, `-` or `@` is executed by Excel and Sheets on open, so those
 *     cells are prefixed with a single quote, the standard mitigation.
 */

export const EXPORT_ROW_CAP = 50_000;

export interface ExportRow {
  id: string;
  to: string;
  from: string;
  subject: string;
  stream: string;
  status: string;
  provider: string | null;
  providerMessageId: string | null;
  createdAt: string;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Quote a cell, and defuse spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const EXPORT_COLUMNS = [
  "id",
  "to",
  "from",
  "subject",
  "stream",
  "status",
  "provider",
  "provider_message_id",
  "created_at",
] as const;

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const r of rows.slice(0, EXPORT_ROW_CAP)) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.to),
        csvCell(r.from),
        csvCell(r.subject),
        csvCell(r.stream),
        csvCell(r.status),
        csvCell(r.provider),
        csvCell(r.providerMessageId),
        csvCell(r.createdAt),
      ].join(",")
    );
  }
  return lines.join("\n");
}

/** Filename that encodes the scope, so two exports are never mistaken for each other. */
export function exportFilename(projectSlug: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const safeSlug = projectSlug.replace(/[^a-z0-9-]/gi, "-").slice(0, 40) || "project";
  return `emails-${safeSlug}-${stamp}.csv`;
}
