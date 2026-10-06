import { and, eq, lt, or, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * M5.1 shared read helpers: cursor pagination (createdAt DESC, id tiebreak)
 * and search param hygiene. Pure functions; each read page composes them.
 * Cursors are opaque base64url of "iso|id" to keep keys off-screen (not
 * a security boundary — data scoping still comes from project WHEREs).
 */

export type Cursor = { createdAt: Date; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | string[] | undefined): Cursor | null {
  if (raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length !== 1 || !raw[0]) throw new Error("Invalid pagination cursor.");
    raw = raw[0];
  }
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid pagination cursor.");
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[1].length > 255) {
      throw new Error("shape");
    }
    const createdAt = new Date(parts[0]);
    if (Number.isNaN(createdAt.getTime())) throw new Error("date");
    return { createdAt, id: parts[1] };
  } catch {
    throw new Error("Invalid pagination cursor.");
  }
}

/** WHERE fragment for "rows strictly older than cursor" under (createdAt DESC, id DESC). */
export function cursorWhere(
  cursor: Cursor | null,
  createdAtCol: SQLWrapper,
  idCol: SQLWrapper
): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(createdAtCol, cursor.createdAt),
    and(eq(createdAtCol, cursor.createdAt), lt(idCol, cursor.id))
  );
}

export function stringParam(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

export const PAGE_SIZE = 40;
