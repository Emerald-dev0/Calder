import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionUser } from "@calder/auth";
import {
  getDb,
  listNotifications,
  markNotificationsRead,
  unreadConversationCounts,
  unreadNotificationCount,
} from "@calder/db";

/**
 * The notification feed behind the bell.
 *
 * A route rather than a server action because the shell polls it: the bell is
 * mounted on every page and its count has to change while the user sits still.
 * There is deliberately no websocket or SSE — the dashboard runs on serverless
 * functions, so a socket would need a second piece of infrastructure for a
 * number that is already cheap to poll. Focus, navigation and a slow poll cover
 * it.
 *
 * Everything is scoped to the session user: the query never accepts a user id
 * from the request, so one person cannot read another's notifications.
 */

async function currentUserId(): Promise<string | null> {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  return user?.userId ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  const [items, count] = await Promise.all([
    listNotifications(db, { userId, limit: 6 }),
    unreadNotificationCount(db, userId),
  ]);

  // Inbox unread is a separate signal: a conversation that arrived before this
  // feature shipped has no notification row, and the badge should still show it.
  const inbox = await unreadConversationCounts(db, { userId });

  return NextResponse.json(
    { count, items, inboxUnread: inbox.total },
    { headers: { "cache-control": "no-store" } }
  );
}

/** Mark some (or all) notifications read. Body: `{ ids?: string[] }`. */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let ids: string[] | undefined;
  try {
    const body = (await request.json()) as { ids?: unknown };
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((id): id is string => typeof id === "string").slice(0, 100);
    }
  } catch {
    // No body means "mark everything read".
  }

  const marked = await markNotificationsRead(getDb(), { userId, ids });
  const count = await unreadNotificationCount(getDb(), userId);
  return NextResponse.json({ marked, count });
}
