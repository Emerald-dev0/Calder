import { eq, and, isNull } from "drizzle-orm";
import { getDb, projects, domains, senderIdentities, type DbClient } from "@calder/db";
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

export interface ResolveSenderOptions {
  /**
   * Permit an address that has no sender identity on the project.
   *
   * Set by exactly two callers and nothing else:
   *
   *  - test-mode sends (`env === "test"`): the provider is mocked, so there is
   *    no identity to check against and no reputation to protect;
   *  - the platform's own operational mail, which is written by us and sent
   *    from our own fixed address.
   *
   * Customer live traffic must not set it: that is the hole this closes.
   */
  allowUnattributed?: boolean;
}

/** The domain part of an address, lowercased. `a@b.c` → `b.c`. */
export function addressDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return (
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() || null
  );
}

/**
 * Resolve `from` (sender ID or bare address) for a project.
 *
 * - sender_xxx: must exist IN THIS PROJECT (cross-org IDs reject as unknown),
 *   must not be archived, and must be verified/connected, otherwise a
 *   plain-language error.
 * - bare address: if an identity exists for it, it must be usable (a disabled
 *   sender stays disabled even by string) and its id is attached.
 *
 * A bare address with **no** identity used to proceed unattributed, always.
 * That made "send from anything" the default for live traffic: SES only
 * enforces that the *domain* is verified, so a customer could send from any
 * mailbox at a domain they own — including someone else's address there — and
 * we had no idea who it came from. Now it is refused unless one of the two
 * legitimate cases applies: the caller is test-mode/platform mail
 * (`allowUnattributed`), or the project has explicitly opted in *and* the
 * domain is verified on the project (the customer proved they control it, and
 * asked for raw addresses). Everything else is a `422` naming Senders.
 *
 * Project access is established upstream from the API key scope; every query
 * here is project-scoped, so no cross-organization resolution is possible.
 */
export async function resolveSender(
  db: DbClient,
  projectId: string,
  from: string,
  options: ResolveSenderOptions = {}
): Promise<ResolvedSender> {
  const ref = parseSenderRef(from);

  if (ref.kind === "id") {
    const [sender] = await db
      .select()
      .from(senderIdentities)
      .where(
        and(
          eq(senderIdentities.id, ref.id),
          eq(senderIdentities.projectId, projectId),
          // Archived senders are not selectable, exactly as they are absent
          // from every dashboard picker.
          isNull(senderIdentities.archivedAt)
        )
      )
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
    await touchSender(db, sender.id, projectId);
    return { senderIdentityId: sender.id, email: sender.email, displayName: sender.displayName };
  }

  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(and(eq(senderIdentities.email, ref.email), eq(senderIdentities.projectId, projectId)))
    .limit(1);
  if (!sender) {
    if (options.allowUnattributed) {
      return { senderIdentityId: null, email: ref.email, displayName: null };
    }
    const domain = addressDomain(ref.email);
    const [project] = await db
      .select({ metadata: projects.metadata })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const optedIn = project?.metadata?.allowUnattributedSenders === true;
    const verifiedDomain =
      domain && optedIn
        ? (
            await db
              .select({ id: domains.id })
              .from(domains)
              .where(
                and(
                  eq(domains.projectId, projectId),
                  eq(domains.domain, domain),
                  eq(domains.status, "verified")
                )
              )
              .limit(1)
          ).length > 0
        : false;
    if (!verifiedDomain) {
      throw new AppError(
        "sender_not_ready",
        `${ref.email} isn't a verified sender on this project. ` +
          (domain
            ? `Add it in Senders, or send from a sender Calder has verified at ${domain}. `
            : "Add it in Senders. ") +
          "Live sends may only use a verified sender identity.",
        422
      );
    }
    // Permitted by the project's own opt-in at a domain it has verified.
    return { senderIdentityId: null, email: ref.email, displayName: null };
  }
  // An archived identity may not send even by bare address: the legacy string
  // path must not become a way to keep using a sender someone retired.
  if (sender.archivedAt) {
    throw new AppError(
      "sender_not_ready",
      `${sender.email} is archived. Restore it in Senders before sending from it.`,
      422
    );
  }
  if (!isSenderUsable(sender.status)) {
    throw new AppError(
      "sender_not_ready",
      `${sender.email} is ${sender.status}. Re-enable it before sending.`,
      422
    );
  }
  await touchSender(db, sender.id, projectId);
  return { senderIdentityId: sender.id, email: sender.email, displayName: sender.displayName };
}

async function touchSender(db: DbClient, id: string, projectId: string): Promise<void> {
  try {
    await db
      .update(senderIdentities)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(senderIdentities.id, id), eq(senderIdentities.projectId, projectId)));
  } catch {
    // Usage timestamps must never break a send.
  }
}

export function getDbClient(): DbClient {
  return getDb();
}
