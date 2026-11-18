import { eq } from "drizzle-orm";
import { users, type DbClient } from "@calder/db";
import { sendCompanyEmailQuietly } from "@calder/notify";
import { logger } from "@calder/observability";
import { resolveWelcomeSender } from "./control/senders";

/**
 * The welcome email, from whichever door someone came in through.
 *
 * `account.welcome` used to be sent from exactly one place — the email-code
 * verification route — so a person who signed up with Google or GitHub was
 * never welcomed at all, and a person who arrived by magic link got the
 * product's silence. The template existed; only one path could reach it.
 *
 * The idempotency key is the *person*, not the event: `welcome:<userId>`. That
 * is what makes it safe to call from every sign-in path — the first one claims
 * the key and every later one is a replay that sends nothing. It is also the
 * reason this can be called on a returning user's login without fear.
 *
 * The From line is the deployment's choice (`COMPANY_WELCOME_FROM`), because the
 * copy promises a reply reaches a person; a value that is not on the declared
 * sender list is reported here, next to the send it affected, rather than
 * silently honoured or silently dropped.
 *
 * Failures are swallowed: an unreachable inbox must never fail a sign-in.
 */
/**
 * How old an account may be and still be welcomed.
 *
 * Without this, adding the OAuth and magic-link paths would have mailed a
 * "Welcome aboard" to every existing user who had never seen one — at their
 * next sign-in, months after they joined. A welcome is for someone arriving,
 * not for someone who has been here all along, and a mailshot cannot be
 * recalled. A week is generous enough to cover a person who signs up, wanders
 * off and comes back, and short enough that nobody established receives one.
 */
export const WELCOME_WINDOW_DAYS = 7;

/**
 * Is this account still new enough to be welcomed?
 *
 * Pure, so the rule can be tested without a database or a provider. An absent
 * date counts as new: `users.created_at` is NOT NULL, so a missing value means
 * the lookup did not find what the session said existed, and suppressing a
 * welcome for a genuinely new person is worse than a send that may not land.
 */
export function isWithinWelcomeWindow(
  createdAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!createdAt) return true;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return true;
  return now.getTime() - created <= WELCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export async function sendWelcomeEmail(
  db: DbClient,
  user: { userId: string; email: string; name?: string | null }
): Promise<void> {
  const [account] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1);

  // An account that has been here longer than the window is not arriving; it is
  // already here. Sending now would be a retroactive mailshot to everyone who
  // never happened to get a welcome.
  if (!isWithinWelcomeWindow(account?.createdAt ?? null)) return;

  const welcome = resolveWelcomeSender();
  if (welcome.ignored) {
    logger.warn(
      { configured: welcome.ignored, usedInstead: welcome.sender.email },
      "COMPANY_WELCOME_FROM is not on the declared sender list; the welcome email used the default sender"
    );
  }

  await sendCompanyEmailQuietly(db, {
    id: "account.welcome",
    to: user.email,
    userId: user.userId,
    from: welcome.sender.label,
    idempotencyKey: `welcome:${user.userId}`,
    data: { name: user.name ?? undefined },
  });
}
