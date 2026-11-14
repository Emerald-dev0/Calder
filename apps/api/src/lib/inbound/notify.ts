import { eq } from "drizzle-orm";
import { getConfig } from "@calder/config";
import { inboxConversations, type DbClient } from "@calder/db";
import { notifyInboxActivity } from "@calder/notify";
import { logger } from "@calder/observability";
import type { ParsedInbound } from "./parse.js";

/**
 * Announce newly-routed mail to the humans who own the inbox.
 *
 * Split out of `ingest.ts` for two reasons: it runs *after* the ingest
 * transaction commits (so a notification can never roll back stored mail), and
 * it is entirely best-effort — every failure is logged and swallowed. Receiving
 * a message is the valuable thing; telling someone about it is secondary, and a
 * mail-provider outage must not turn into a 500 that makes SNS retry a message
 * we already stored.
 *
 * Which event, and who hears about it, is decided by `planRecipients` in
 * `@calder/db`:
 *
 *  - new conversation → every member of the inbox (the shared-queue model)
 *  - reply on a threaded conversation → the assignee only, at most hourly
 *  - machine mail (auto-responders, lists, bounces) → nobody, ever
 */
export async function announceRoutedMail(
  db: DbClient,
  input: {
    inboxId: string | null;
    conversationId: string | null;
    /** True when this message opened a new conversation. */
    started: boolean;
    messageId: string;
    parsed: ParsedInbound;
    receivedAt: Date;
  }
): Promise<void> {
  if (!input.inboxId || !input.conversationId) return; // unrouted mail has no audience

  try {
    let assigneeUserId: string | null = null;
    if (!input.started) {
      const [conversation] = await db
        .select({ assigneeUserId: inboxConversations.assigneeUserId })
        .from(inboxConversations)
        .where(eq(inboxConversations.id, input.conversationId))
        .limit(1);
      assigneeUserId = conversation?.assigneeUserId ?? null;
    }

    const fromAddress = input.parsed.from?.address ?? null;
    const result = await notifyInboxActivity(
      db,
      {
        kind: input.started ? "inbox.new_conversation" : "inbox.reply_received",
        inboxId: input.inboxId,
        conversationId: input.conversationId,
        subject: input.parsed.subject,
        fromName: input.parsed.from?.name ?? null,
        fromAddress,
        preview: input.parsed.bodyText,
        // Loop prevention lives in the policy, not here: auto-responders and
        // mailing lists must never start a notification ping-pong.
        message: {
          headers: input.parsed.headers ?? {},
          fromAddress,
          subject: input.parsed.subject,
        },
        assigneeUserId,
      },
      { appUrl: getConfig().DASHBOARD_URL }
    );

    if (result.notified === 0) {
      logger.debug(
        { messageId: input.messageId, reason: result.reason },
        "inbound mail did not notify anyone"
      );
    }
  } catch (err) {
    logger.warn({ err, messageId: input.messageId }, "inbox notification failed");
  }
}
