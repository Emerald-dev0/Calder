import type { DbClient } from "@calder/db";
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
export async function sendWelcomeEmail(
  db: DbClient,
  user: { userId: string; email: string; name?: string | null }
): Promise<void> {
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
