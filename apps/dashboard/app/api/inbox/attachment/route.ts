import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, inboundAttachments, inboundMessages } from "@calder/db";
import { getRawMessageStore, InboundObjectNotFound } from "@calder/providers";
import { resolveInboxAccess, InboxAccessError } from "../../../../lib/inbox/guard";

/**
 * Attachment download for the inbox.
 *
 * Deliberately a server route rather than a presigned URL: the lookup proves the
 * signed-in person can open the inbox that received this message, the S3 key
 * never reaches the browser, and access is revoked the moment membership is.
 *
 * `Content-Disposition: attachment` plus `nosniff` means a hostile filename or
 * content type cannot run in the dashboard's origin.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const messageId = url.searchParams.get("message") ?? "";
  const attachmentId = url.searchParams.get("attachment") ?? "";
  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: "message and attachment are required" }, { status: 400 });
  }

  const db = getDb();
  const [row] = await db
    .select({
      inboxId: inboundMessages.inboxId,
      storageKey: inboundAttachments.storageKey,
      filename: inboundAttachments.filename,
      contentType: inboundAttachments.contentType,
    })
    .from(inboundAttachments)
    .innerJoin(inboundMessages, eq(inboundMessages.id, inboundAttachments.inboundMessageId))
    .where(
      and(
        eq(inboundAttachments.id, attachmentId),
        eq(inboundAttachments.inboundMessageId, messageId)
      )
    )
    .limit(1);

  // 404 for a missing attachment and for one in an inbox this user cannot open:
  // attachment ids are not a capability.
  if (!row || !row.inboxId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    await resolveInboxAccess(row.inboxId);
  } catch (err) {
    if (err instanceof InboxAccessError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  if (!row.storageKey) {
    return NextResponse.json(
      { error: "This attachment was recorded but its contents were not stored." },
      { status: 404 }
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await getRawMessageStore().get(row.storageKey);
  } catch (err) {
    if (err instanceof InboundObjectNotFound) {
      return NextResponse.json(
        { error: "Attachment contents are no longer stored." },
        { status: 404 }
      );
    }
    throw err;
  }

  const filename = (row.filename ?? "attachment").replace(/[\r\n"\\]/g, "_").slice(0, 180);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.contentType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
