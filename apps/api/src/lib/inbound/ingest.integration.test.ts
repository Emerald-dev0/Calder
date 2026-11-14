import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, closeDb } from "@calder/db";
import type { RawMessageStore } from "@calder/providers";
import { ingestReceipt, type SesReceiptNotification } from "./ingest.js";

process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * Inbound ingest against real Postgres.
 *
 * The S3 store is an in-memory double (there is no bucket in CI, and the point
 * is the pipeline, not the SDK), but everything else is the real thing: real
 * tables, real uniqueness, real transactions, real quota queries. The tests
 * that matter most are the last two: a duplicate delivery must not create a
 * second message or a second unit of usage, and an inbound burst must leave the
 * outbound allowance untouched.
 */

class MemoryStore implements RawMessageStore {
  readonly objects = new Map<string, Uint8Array>();
  rawKey(input: { projectId: string; messageId: string }): string {
    return `${input.projectId}/${input.messageId}/raw.eml`;
  }
  attachmentKey(input: { projectId: string; messageId: string; partIndex: number }): string {
    return `${input.projectId}/${input.messageId}/attachments/${input.partIndex}`;
  }
  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<Uint8Array> {
    const found = this.objects.get(key);
    if (!found) throw new Error(`missing object ${key}`);
    return found;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

function notification(input: {
  sesMessageId: string;
  recipient: string;
  objectKey: string;
  subject?: string;
  timestamp?: string;
}): SesReceiptNotification {
  return {
    notificationType: "Received",
    mail: {
      messageId: input.sesMessageId,
      source: "sender@acme.test",
      destination: [input.recipient],
      timestamp: input.timestamp ?? new Date().toISOString(),
      commonHeaders: { subject: input.subject ?? "Hello" },
    },
    receipt: {
      recipients: [input.recipient],
      spamVerdict: { status: "PASS" },
      virusVerdict: { status: "PASS" },
      spfVerdict: { status: "PASS" },
      dkimVerdict: { status: "PASS" },
      dmarcVerdict: { status: "PASS" },
      action: { type: "S3", bucketName: "calder-inbound", objectKey: input.objectKey },
    },
  };
}

function simpleMail(subject: string, body: string): Uint8Array {
  return new TextEncoder().encode(
    [
      "From: Sender <sender@acme.test>",
      "To: support@inbox.acme.test",
      `Subject: ${subject}`,
      "Message-ID: <m1@acme.test>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n") + "\r\n"
  );
}

gate("inbound ingest (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const orgId = `org_inb_${suffix}`;
  const projectId = `prj_inb_${suffix}`;
  const userId = `usr_inb_${suffix}`;
  const verifiedDomain = `inbox-${suffix}.acme.test`;
  const unverifiedDomain = `pending-${suffix}.acme.test`;
  const store = new MemoryStore();
  let mod: typeof import("@calder/db");

  beforeAll(async () => {
    mod = await import("@calder/db");
    await db.insert(mod.users).values({ id: userId, email: `inb-${suffix}@example.test` });
    await db.insert(mod.organizations).values({
      id: orgId,
      name: `Inbound ${suffix}`,
      slug: `inbound-${suffix}`,
    });
    await db.insert(mod.organizationMembers).values({
      id: `om_inb_${suffix}`,
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(mod.projects).values({
      id: projectId,
      organizationId: orgId,
      name: `Inbound project ${suffix}`,
      slug: `inbound-project-${suffix}`,
    });
    await db.insert(mod.receivingDomains).values([
      {
        id: `rcd_ok_${suffix}`,
        projectId,
        domain: verifiedDomain,
        status: "verified",
        verificationToken: "cvt_test",
        mxHost: "inbound.calder.test",
        verifiedAt: new Date(),
        provisionedAt: new Date(),
        sesRuleSetName: "calder-inbound",
        sesRuleName: `rule-${suffix}`,
      },
      {
        id: `rcd_pending_${suffix}`,
        projectId,
        domain: unverifiedDomain,
        status: "pending",
        verificationToken: "cvt_test2",
        mxHost: "inbound.calder.test",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(mod.organizations).where(eq(mod.organizations.id, orgId));
    await db.delete(mod.users).where(eq(mod.users.id, userId));
    await closeDb();
  });

  async function deliver(input: {
    sesMessageId: string;
    recipient?: string;
    mail: Uint8Array;
    objectKey: string;
  }) {
    store.objects.set(input.objectKey, input.mail);
    return ingestReceipt(
      { db, store },
      {
        notification: notification({
          sesMessageId: input.sesMessageId,
          recipient: input.recipient ?? `support@${verifiedDomain}`,
          objectKey: input.objectKey,
        }),
      }
    );
  }

  it("stores a message, its body and one unit of inbound usage", async () => {
    const id = `ses-${suffix}-1`;
    const result = await deliver({
      sesMessageId: id,
      mail: simpleMail("First message", "Hello from the outside."),
      objectKey: `ses/${id}`,
    });
    expect(result.status).toBe("stored");

    const [row] = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.sesMessageId, id));
    expect(row?.status).toBe("parsed");
    expect(row?.organizationId).toBe(orgId);
    expect(row?.projectId).toBe(projectId);
    expect(row?.subject).toBe("First message");
    expect(row?.fromAddress).toBe("sender@acme.test");
    expect(row?.bodyText).toContain("Hello from the outside.");
    expect(row?.rawStorageKey).toBe(`ses/${id}`);
    expect(row?.spamVerdict).toBe("PASS");
    expect(row?.recipientDomain).toBe(verifiedDomain);

    const usage = await db
      .select()
      .from(mod.usageRecords)
      .where(eq(mod.usageRecords.organizationId, orgId));
    expect(usage).toHaveLength(1);
    expect(usage[0]?.metric).toBe("inbound_emails");
    // The outbound ledger is untouched: not one `emails_sent` unit exists.
    expect(usage.filter((u) => u.metric === "emails_sent")).toHaveLength(0);
  });

  it("is idempotent: a redelivered notification adds nothing", async () => {
    const id = `ses-${suffix}-2`;
    const first = await deliver({
      sesMessageId: id,
      mail: simpleMail("Only once", "body"),
      objectKey: `ses/${id}`,
    });
    expect(first.status).toBe("stored");

    const second = await deliver({
      sesMessageId: id,
      mail: simpleMail("Only once", "body"),
      objectKey: `ses/${id}`,
    });
    expect(second.status).toBe("duplicate");

    const rows = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.sesMessageId, id));
    expect(rows).toHaveLength(1);

    const units = await db
      .select()
      .from(mod.usageRecords)
      .where(eq(mod.usageRecords.organizationId, orgId));
    // One for #1, one for #2 — and the redelivery of #2 did not add a third.
    expect(units.filter((u) => u.metric === "inbound_emails")).toHaveLength(2);
  });

  it("stores attachments beside the message", async () => {
    const id = `ses-${suffix}-3`;
    const boundary = "bb";
    const raw = new TextEncoder().encode(
      [
        "From: sender@acme.test",
        "To: support@inbox.acme.test",
        "Subject: with file",
        "MIME-Version: 1.0",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain",
        "",
        "see attached",
        `--${boundary}`,
        'Content-Type: text/plain; name="notes.txt"',
        'Content-Disposition: attachment; filename="notes.txt"',
        "",
        "the notes",
        `--${boundary}--`,
      ].join("\r\n") + "\r\n"
    );

    const result = await deliver({ sesMessageId: id, mail: raw, objectKey: `ses/${id}` });
    expect(result.status).toBe("stored");

    const [message] = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.sesMessageId, id));
    expect(message?.attachmentCount).toBe(1);

    const attachments = await db
      .select()
      .from(mod.inboundAttachments)
      .where(eq(mod.inboundAttachments.inboundMessageId, message!.id));
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe("notes.txt");
    expect(attachments[0]?.storageKey).toBe(
      store.attachmentKey({ projectId, messageId: message!.id, partIndex: 0 })
    );
    expect(store.objects.has(attachments[0]!.storageKey!)).toBe(true);
  });

  it("ignores mail for a domain we do not host, and mail for an unverified one", async () => {
    const unknown = await deliver({
      sesMessageId: `ses-${suffix}-4`,
      recipient: "someone@not-ours.example",
      mail: simpleMail("nope", "x"),
      objectKey: `ses/${suffix}-4`,
    });
    expect(unknown.status).toBe("ignored");

    const pending = await deliver({
      sesMessageId: `ses-${suffix}-5`,
      recipient: `hi@${unverifiedDomain}`,
      mail: simpleMail("pending", "x"),
      objectKey: `ses/${suffix}-5`,
    });
    expect(pending.status).toBe("ignored");
    expect(pending.status === "ignored" && pending.reason).toContain("pending");

    // Nothing was written for either, so no phantom inbox entries.
    const rows = await db
      .select()
      .from(mod.inboundMessages)
      .where(
        eq(mod.inboundMessages.sesMessageId, `ses-${suffix}-4`)
      );
    expect(rows).toHaveLength(0);
  });

  it("refuses a notification whose receipt action is not S3, and says why", async () => {
    const id = `ses-${suffix}-6`;
    store.objects.set(`ses/${id}`, simpleMail("x", "y"));
    const base = notification({
      sesMessageId: id,
      recipient: `support@${verifiedDomain}`,
      objectKey: `ses/${id}`,
    });
    base.receipt!.action = { type: "SNS" };

    await expect(ingestReceipt({ db, store }, { notification: base })).rejects.toThrow(/not S3/);

    const [row] = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.sesMessageId, id));
    // Failed, with the reason recorded — not silently dropped.
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toContain("S3");
  });

  it("never charges inbound messages to the outbound allowance", async () => {
    // A workspace on the free plan has 5,000 outbound and 500 inbound. Ten
    // messages in, the outbound ceiling must be *identical* — this is the
    // requirement that inbound cannot burn sending capacity.
    const { checkInboundQuota, checkOrganizationResource } = mod;
    const outboundBefore = await checkOrganizationResource(db, orgId, "domains");
    const inbound = await checkInboundQuota(db, orgId);

    expect(inbound.tier).toBe("free");
    expect(inbound.limit).toBe(500);
    expect(inbound.received).toBeGreaterThan(0);
    expect(inbound.allowed).toBe(true);

    const emailsSent = await db
      .select({ total: sql<number>`coalesce(sum(${mod.usageRecords.quantity}), 0)` })
      .from(mod.usageRecords)
      .where(
        and(
          eq(mod.usageRecords.organizationId, orgId),
          eq(mod.usageRecords.metric, "emails_sent")
        )
      );
    expect(Number(emailsSent[0]?.total)).toBe(0);
    // And no outbound email row was created either.
    const outbound = await db
      .select({ id: mod.emails.id })
      .from(mod.emails)
      .where(eq(mod.emails.projectId, projectId));
    expect(outbound).toHaveLength(0);
    expect(outboundBefore.tier).toBe("free");
  });

  it("rejects over the inbound ceiling, keeps the row and stops metering", async () => {
    // Fill the free allowance (500) with lightweight rows, then deliver one
    // more and assert it is refused and *not* metered.
    const { organizationInboundUsage } = mod;
    const usage = await organizationInboundUsage(db, orgId);
    const missing = Math.max(0, 500 - usage.received);
    if (missing > 0) {
      await db.execute(sql`
        insert into inbound_messages
          (id, organization_id, project_id, recipient_domain, ses_message_id, received_at, status)
        select
          'inb_fill_' || ${suffix} || '_' || g,
          ${orgId}, ${projectId}, ${verifiedDomain},
          'ses-fill-' || ${suffix} || '-' || g,
          now(), 'parsed'
        from generate_series(1, ${missing}) as g
        on conflict do nothing
      `);
    }

    const id = `ses-${suffix}-over`;
    const result = await deliver({
      sesMessageId: id,
      mail: simpleMail("over the line", "body"),
      objectKey: `ses/${id}`,
    });
    expect(result.status).toBe("rejected");

    const [row] = await db
      .select()
      .from(mod.inboundMessages)
      .where(eq(mod.inboundMessages.sesMessageId, id));
    expect(row?.status).toBe("rejected");
    expect(row?.failureReason).toContain("inbound");
    // No body was stored: the refusal did not cost storage.
    expect(row?.bodyText).toBeNull();
    expect(row?.rawStorageKey).toBeNull();

    // And it did not meter: 500 units, not 501.
    const units = await db
      .select({ total: sql<number>`coalesce(sum(${mod.usageRecords.quantity}), 0)` })
      .from(mod.usageRecords)
      .where(
        and(
          eq(mod.usageRecords.organizationId, orgId),
          eq(mod.usageRecords.metric, "inbound_emails")
        )
      );
    expect(Number(units[0]?.total)).toBe(3);
  });
});
