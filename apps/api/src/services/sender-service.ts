import { eq, and } from "drizzle-orm";
import { getDb, senderIdentities, type DbClient } from "@calder/db";
import { AppError } from "../errors/index.js";

export type SenderRef = { kind: "id"; id: string } | { kind: "email"; email: string };

const SENDER_ID_RE = /^sender_[A-Za-z0-9_-]{1,64}$/;

/** Split a `from` value into a sender-identity reference or a bare address. Pure. */
export function parseSenderRef(from: string): SenderRef {
  const trimmed = from.trim();
  if (SENDER_ID_RE.test(trimmed)) return { kind: "id", id: trimmed };
  return { kind: "email", email: trimmed };
}

/** Statuses a sender may actually send from. Everything else explains itself. */
export function isSenderUsable(status: string): boolean {
  return status === "verified" || status === "connected";
}

export interface ResolvedSender {
  senderIdentityId: string | null;
  email: string;
  displayName: string | null;
}

/**
 * Resolve `from` (sender ID or bare address) for a project.
 *
 * - sender_xxx: must exist IN THIS PROJECT (cross-org IDs reject as unknown)
 *   and be verified/connected, otherwise a plain-language error.
 * - bare address: legacy path. If an identity exists for it, it must be
 *   usable (a disabled sender stays disabled even by string) and its id is
 *   attached; otherwise the send proceeds unattributed.
 *
 * Project access is established upstream from the API key scope; every query
 * here is project-scoped, so no cross-organization resolution is possible.
 */
export async function resolveSender(
  db: DbClient,
  projectId: string,
  from: string
): Promise<ResolvedSender> {
  const ref = parseSenderRef(from);

  if (ref.kind === "id") {
    const [sender] = await db
      .select()
      .from(senderIdentities)
      .where(and(eq(senderIdentities.id, ref.id), eq(senderIdentities.projectId, projectId)))
      .limit(1);
    if (!sender) {
      throw new AppError(
        "validation_error",
        "Unknown sender for this project. Pick one from Senders.",
        400
      );
    }
    if (!isSenderUsable(sender.status)) {
      throw new AppError(
        "sender_not_ready",
        sender.status === "pending"
          ? `${sender.email} isn't verified yet. Verify it before sending.`
          : `${sender.email} is ${sender.status}. Re-enable it before sending.`,
        422
      );
    }
    await touchSender(db, sender.id);
    return { senderIdentityId: sender.id, email: sender.email, displayName: sender.displayName };
  }

  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.email, ref.email), eq(senderIdentities.projectId, projectId)))
    .limit(1);
  if (!sender) return { senderIdentityId: null, email: ref.email, displayName: null };
  if (!isSenderUsable(sender.status)) {
    throw new AppError(
      "sender_not_ready",
      `${sender.email} is ${sender.status}. Re-enable it before sending.`,
      422
    );
  }
  await touchSender(db, sender.id);
  return { senderIdentityId: sender.id, email: sender.email, displayName: sender.displayName };
}

async function touchSender(db: DbClient, id: string): Promise<void> {
  try {
    await db
      .update(senderIdentities)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(senderIdentities.id, id));
  } catch {
    // Usage timestamps must never break a send.
  }
}

export function getDbClient(): DbClient {
  return getDb();
}
