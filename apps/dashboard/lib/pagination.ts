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
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const [iso, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
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
