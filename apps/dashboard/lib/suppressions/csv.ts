import { CANONICAL_REASONS } from "./reasons";

/**
 * CSV parsing for suppression imports.
 *
 * Pure and dependency-free so it can be tested exhaustively without a database:
 * the failure mode that matters here is a bad file causing an operator to
 * believe rows were imported when they were not, or vice versa.
 *
 * Accepted input:
 *   - a header row naming `email`/`address` and optionally `reason`/`type`,
 *     in any column order;
 *   - no header at all (bare addresses, one per line);
 *   - comma, semicolon or tab separated;
 *   - quoted cells, `""` escapes, CRLF or LF endings;
 *   - blank lines, which are ignored rather than counted as invalid.
 */

/** Rows materialised for the preview table; counts always cover the whole file. */
export const PREVIEW_LIMIT = 500;

export type ParsedStatus = "valid" | "invalid" | "duplicate";
export type RowStatus = ParsedStatus | "existing";

export interface ParsedRow {
  line: number;
  email: string;
  reason: string;
  status: ParsedStatus;
  message?: string;
}

export interface ParsedCsv {
  rows: ParsedRow[];
  /** Rows that would be inserted (before the existing-rows check). */
  valid: number;
  invalid: number;
  duplicate: number;
  /** True when parsing stopped at `limit`; counts still reflect the whole file. */
  truncated: boolean;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_REASON = "import";

/** Split one CSV line, honouring quotes. */
function splitCells(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** Pick the delimiter from the header line; comma unless a clear alternative wins. */
function detectDelimiter(line: string): string {
  const counts = [",", ";", "\t"].map((d) => ({ d, n: line.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

export interface ParseOptions {
  /** Maximum number of row objects to materialise. Counts are unaffected. */
  limit?: number;
}

export function parseSuppressionCsv(csv: string, options: ParseOptions = {}): ParsedCsv {
  const limit = options.limit ?? PREVIEW_LIMIT;
  const lines = csv.replace(/\r\n?/g, "\n").split("\n");

  const firstLine = lines.find((l) => l.trim()) ?? "";
  const delimiter = detectDelimiter(firstLine);
  const firstCells = splitCells(firstLine, delimiter).map((c) => c.toLowerCase());

  let startIndex = 0;
  let emailCol = 0;
  let reasonCol = 1;
  if (firstCells.includes("email") || firstCells.includes("address")) {
    emailCol = firstCells.findIndex((c) => c === "email" || c === "address");
    const r = firstCells.findIndex((c) => c === "reason" || c === "type");
    reasonCol = r >= 0 ? r : -1;
    // Skip every line up to and including the header.
    startIndex = lines.indexOf(firstLine) + 1;
  }

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  let truncated = false;

  for (let i = startIndex; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (!raw.trim()) continue;

    const cells = splitCells(raw, delimiter);
    const email = (cells[emailCol] ?? "").toLowerCase();
    const reasonRaw = reasonCol >= 0 ? (cells[reasonCol] ?? "").toLowerCase() : "";
    const reason = (CANONICAL_REASONS as readonly string[]).includes(reasonRaw)
      ? reasonRaw
      : DEFAULT_REASON;

    const push = (row: ParsedRow) => {
      if (rows.length < limit) rows.push(row);
      else truncated = true;
    };

    if (!EMAIL_RE.test(email)) {
      invalid++;
      push({
        line: i + 1,
        email: email || raw.slice(0, 80),
        reason,
        status: "invalid",
        message: "Not a valid email address.",
      });
      continue;
    }

    if (seen.has(email)) {
      duplicate++;
      push({
        line: i + 1,
        email,
        reason,
        status: "duplicate",
        message: "Repeated within this file.",
      });
      continue;
    }

    seen.add(email);
    valid++;
    push({ line: i + 1, email, reason, status: "valid" });
  }

  return { rows, valid, invalid, duplicate, truncated };
}
