import { AppError } from "../errors/index.js";

/**
 * Decode the opaque cursor used by API collection endpoints. Cursors are a
 * position, not an authorization token: every caller still receives a query
 * with its project predicate. Malformed cursors are client errors rather than
 * silently being treated as the first page, which prevents retries from
 * returning surprising data and makes pagination failures observable.
 */
export function decodeApiCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (raw === undefined) return null;
  if (raw === "" || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new AppError("validation_error", "Invalid pagination cursor.", 400);
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
    throw new AppError("validation_error", "Invalid pagination cursor.", 400);
  }
}

export function encodeApiCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}
