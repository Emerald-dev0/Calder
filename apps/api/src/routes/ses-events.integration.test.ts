import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase 1, M1.1 + M1.2 — SES feedback ingress, end to end through the
 * HTTP app with REAL RSA signatures (self-signed throwaway fixture cert;
 * the module cert fetcher is swapped so no network is needed):
 * - genuine signature accepted; tampered/forged payloads rejected 400
 * - hostile SigningCertURL rejected BEFORE any cert fetch
 * - duplicate SNS MessageId dedupes end to end (1 ledger row, 1 event)
 * - unknown message id → 200 + unmatched ledger row (no endless redelivery)
 * - delivery/open/click lifecycle; permanent bounce + complaint suppress
 * - transient bounce never suppresses; topic allowlist enforced
 */
gate("POST /v1/ses/events (live Postgres, real RSA signatures)", async () => {
  const { randomBytes, createSign } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { existsSync, mkdirSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    emails,
    emailEvents,
    suppressions,
    providerEvents,
  } = await import("@calder/db");
  const { eq, and, count } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { snsStringToSign, setSnsCertFetcher } = await import("../lib/ses-events.js");
  type SnsEnvelope = import("../lib/ses-events.js").SnsEnvelope;

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_ses_${suffix}`;
  const projId = `proj_ses_${suffix}`;
  const userId = `usr_ses_${suffix}`;
  const TOPIC = `arn:aws:sns:us-east-1:123456789012:ses-events-${suffix}`;
  const CERT_URL = `https://sns.us-east-1.amazonaws.com/fixture-${suffix}.pem`;

  // Throwaway self-signed fixture (gitignored dir; never committed material).
  const fixtureDir = join(here, "..", "lib", "__fixtures__");
  mkdirSync(fixtureDir, { recursive: true });
  const certPath = join(fixtureDir, "sns-test-cert.pem");
  const keyPath = join(fixtureDir, "sns-test-key.pem");
  if (!existsSync(certPath)) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "3650",
        "-nodes",
        "-subj",
        "/CN=sns.test.local",
      ],
      { stdio: "ignore" }
    );
  }
  const certPem = readFileSync(certPath, "utf8");
  const keyPem = readFileSync(keyPath, "utf8");

  const app = createApp();

  function envelope(opts: {
    type?: string;
    messageId?: string;
    subject?: string;
    message: unknown;
    signingCertUrl?: string;
  }): SnsEnvelope {
    const env: SnsEnvelope = {
      Type: opts.type ?? "Notification",
      MessageId: opts.messageId ?? `sns-${randomBytes(8).toString("hex")}`,
      TopicArn: TOPIC,
      Message: typeof opts.message === "string" ? opts.message : JSON.stringify(opts.message),
      Timestamp: new Date().toISOString(),
      SigningCertURL: opts.signingCertUrl ?? CERT_URL,
      SignatureVersion: "1",
      Signature: "UNSIGNED",
      ...(opts.subject ? { Subject: opts.subject } : {}),
    };
    const signer = createSign("RSA-SHA1");
    signer.update(snsStringToSign(env), "utf8");
    return { ...env, Signature: signer.sign(keyPem, "base64") };
  }

  const sesMsg = (messageId: string, eventType: string, extra: Record<string, unknown> = {}) => ({
    mail: {
      messageId,
      timestamp: new Date().toISOString(),
      destination: [`to-${suffix}@example.test`],
    },
    eventType,
    ...extra,
  });

  const post = (env: SnsEnvelope) =>
    app.request("/v1/ses/events", {
      method: "POST",
      headers: { "content-type": "text/plain" }, // SNS posts as text/plain
      body: JSON.stringify(env),
    });

  const emailIds: string[] = [];
  async function seedSent(over: { providerMessageId?: string; status?: string; to?: string } = {}) {
    const db = getDb();
    const id = `em_ses_${randomBytes(6).toString("hex")}`;
    await db.insert(emails).values({
      id,
      projectId: projId,
      from: `ses-${suffix}@test.test`,
      to: over.to ?? `to-${suffix}@example.test`,
      subject: "ses test",
      text: "hello",
      status: (over.status ?? "sent") as never,
      attemptCount: 0,
      providerMessageId: over.providerMessageId ?? `ses-${suffix}-${id}`,
    });
    emailIds.push(id);
    return id;
  }
  const providerMessageIdOf = (id: string) => `ses-${suffix}-${id}`;

  const savedTopics = process.env.SES_SNS_TOPIC_ARNS;

  beforeAll(async () => {
    if (!(await reachable())) return;
    setSnsCertFetcher(async () => certPem);
    delete process.env.SES_SNS_TOPIC_ARNS; // allowlist disabled by default
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `ses-user-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "SES Test", slug: `ses-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_ses_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    setSnsCertFetcher(undefined);
    if (savedTopics === undefined) delete process.env.SES_SNS_TOPIC_ARNS;
    else process.env.SES_SNS_TOPIC_ARNS = savedTopics;
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("delivery: valid signature advances status and writes ledger + event", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const id = await seedSent();
    const env = envelope({
      message: sesMsg(providerMessageIdOf(id), "delivery", {
        delivery: { recipients: [`to-${suffix}@example.test`], smtpResponse: "250 ok" },
      }),
    });
    const res = await post(env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; applied: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("delivered");

    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("delivered");
    const evs = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, id), eq(emailEvents.type, "delivered")));
    expect(Number(evs[0]?.value)).toBe(1);
    const [pev] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.snsMessageId, env.MessageId))
      .limit(1);
    expect(pev).toBeDefined();
    expect(pev?.emailId).toBe(id);
    expect(pev?.projectId).toBe(projId);
    expect(pev?.unmatched).toBe(false);
    expect((pev?.payload as Record<string, unknown>)?.eventType).toBe("delivery");
  });

  it("open and click are engagement events only (status stays delivered)", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const id = await seedSent();
    for (const [type, eventType] of [
      ["delivery", "delivered"],
      ["open", "opened"],
      ["click", "clicked"],
    ] as const) {
      const res = await post(
        envelope({
          message: sesMsg(
            providerMessageIdOf(id),
            type,
            type === "click"
              ? { click: { link: "https://x.test/y" } }
              : type === "open"
                ? { open: {} }
                : type === "delivery"
                  ? { delivery: { recipients: [`to-${suffix}@example.test`] } }
                  : {}
          ),
        })
      );
      expect(res.status).toBe(200);
      const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
      expect(row?.status).toBe(type === "delivery" ? "delivered" : "delivered");
      const evs = await db
        .select({ value: count() })
        .from(emailEvents)
        .where(and(eq(emailEvents.emailId, id), eq(emailEvents.type, eventType as never)));
      expect(Number(evs[0]?.value)).toBe(1);
    }
  });

  it("duplicate SNS MessageId dedupes end to end", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const id = await seedSent();
    const env = envelope({
      message: sesMsg(providerMessageIdOf(id), "delivery", {
        delivery: { recipients: [`to-${suffix}@example.test`] },
      }),
    });
    const first = await post(env);
    expect(first.status).toBe(200);
    const second = await post(env);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const p = await db
      .select({ value: count() })
      .from(providerEvents)
      .where(eq(providerEvents.snsMessageId, env.MessageId));
    expect(Number(p[0]?.value)).toBe(1);
    const evs = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, id), eq(emailEvents.type, "delivered")));
    expect(Number(evs[0]?.value)).toBe(1);
  });

  it("permanent bounce → bounced + suppression (and never double-suppresses)", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const victim = `bnc-${suffix}@example.test`;
    const id = await seedSent({ to: victim });
    const bounce = sesMsg(providerMessageIdOf(id), "bounce", {
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [{ emailAddress: victim, status: "5.1.1" }],
      },
    });
    for (let i = 0; i < 2; i++) {
      // Different SNS MessageIds (e.g. SES sends both feedback topics) must
      // not create two suppressions.
      const res = await post(envelope({ message: bounce }));
      expect(res.status).toBe(200);
    }
    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("bounced");
    const sups = await db
      .select({ value: count() })
      .from(suppressions)
      .where(and(eq(suppressions.projectId, projId), eq(suppressions.email, victim)));
    expect(Number(sups[0]?.value)).toBe(1);
  });

  it("transient bounce records an event but never suppresses or changes status", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const victim = `soft-${suffix}@example.test`;
    const id = await seedSent({ to: victim });
    const res = await post(
      envelope({
        message: sesMsg(providerMessageIdOf(id), "bounce", {
          bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: victim }] },
        }),
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("sent"); // unchanged
    const evs = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, id), eq(emailEvents.type, "bounced")));
    expect(Number(evs[0]?.value)).toBe(1);
    const sups = await db
      .select({ value: count() })
      .from(suppressions)
      .where(and(eq(suppressions.projectId, projId), eq(suppressions.email, victim)));
    expect(Number(sups[0]?.value)).toBe(0);
  });

  it("complaint → complained + suppression", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const victim = `cmp-${suffix}@example.test`;
    const id = await seedSent({ to: victim });
    const res = await post(
      envelope({
        message: sesMsg(providerMessageIdOf(id), "complaint", {
          complaint: {
            complainedRecipients: [{ emailAddress: victim }],
            complaintFeedbackType: "abuse",
          },
        }),
      })
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("complained");
    const sups = await db
      .select({ reason: suppressions.reason })
      .from(suppressions)
      .where(and(eq(suppressions.projectId, projId), eq(suppressions.email, victim)));
    expect(sups.length).toBe(1);
    expect(sups[0]?.reason).toBe("complaint");
  });

  it("unknown message id → 200 with unmatched ledger row (no endless redelivery)", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const env = envelope({
      message: sesMsg(`ses-unknown-${suffix}`, "delivery", {
        delivery: { recipients: ["x@y.test"] },
      }),
    });
    const res = await post(env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { unmatched: boolean }).unmatched).toBe(true);
    const [pev] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.snsMessageId, env.MessageId))
      .limit(1);
    expect(pev?.unmatched).toBe(true);
    expect(pev?.emailId).toBeNull();
  });

  it("tampered payload → 400 and NOTHING is ledgered", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const id = await seedSent();
    const env = envelope({
      message: sesMsg(providerMessageIdOf(id), "delivery", {
        delivery: { recipients: [`to-${suffix}@example.test`] },
      }),
    });
    // Forgery: attacker edits the message after "signing" (payload forged).
    const forged = {
      ...env,
      Message: JSON.stringify(
        sesMsg(providerMessageIdOf(id), "complaint", {
          complaint: { complainedRecipients: [{ emailAddress: `frg-${suffix}@example.test` }] },
        })
      ),
    };
    const res = await post(forged as SnsEnvelope);
    expect(res.status).toBe(400);
    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("sent"); // untouched
    const p = await db
      .select({ value: count() })
      .from(providerEvents)
      .where(eq(providerEvents.snsMessageId, env.MessageId));
    expect(Number(p[0]?.value)).toBe(0);
  });

  it("hostile SigningCertURL → 400 (cert origin is half the trust decision)", async () => {
    if (!(await reachable())) return;
    const id = await seedSent();
    const env = envelope({
      message: sesMsg(providerMessageIdOf(id), "delivery", {
        delivery: { recipients: [`to-${suffix}@example.test`] },
      }),
      signingCertUrl: "https://sns.us-east-1.amazonaws.com.evil.example/cert.pem",
    });
    const res = await post(env);
    expect(res.status).toBe(400);
  });

  it("topic allowlist rejects foreign topics when configured", async () => {
    if (!(await reachable())) return;
    const id = await seedSent();
    process.env.SES_SNS_TOPIC_ARNS = "arn:aws:sns:us-east-1:123456789012:someone-else";
    try {
      const res = await post(
        envelope({
          message: sesMsg(providerMessageIdOf(id), "delivery", {
            delivery: { recipients: [`to-${suffix}@example.test`] },
          }),
        })
      );
      expect(res.status).toBe(400);
    } finally {
      delete process.env.SES_SNS_TOPIC_ARNS;
    }
  });

  it("subscription confirmation requires the allowlist, then confirms", async () => {
    if (!(await reachable())) return;
    const subscribeUrl = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=2336412f`;
    const sub = (): SnsEnvelope => {
      // Build manually: SubscribeURL + Token are part of the signed canonical
      // string and must be present BEFORE signing.
      const env: SnsEnvelope = {
        Type: "SubscriptionConfirmation",
        MessageId: `sns-${randomBytes(8).toString("hex")}`,
        TopicArn: TOPIC,
        Message: `You have chosen to subscribe to the topic ${TOPIC}.`,
        Timestamp: new Date().toISOString(),
        SigningCertURL: CERT_URL,
        SignatureVersion: "1",
        Signature: "UNSIGNED",
        SubscribeURL: subscribeUrl,
        Token: "2336412f",
      };
      const signer = createSign("RSA-SHA1");
      signer.update(snsStringToSign(env), "utf8");
      return { ...env, Signature: signer.sign(keyPem, "base64") };
    };

    // Without an allowlist: refuse to auto-confirm (200 so SNS stops retrying).
    delete process.env.SES_SNS_TOPIC_ARNS;
    const res1 = await post(sub());
    expect(res1.status).toBe(200);
    expect(((await res1.json()) as { ok: boolean }).ok).toBe(false);

    // With the allowlist: the SubscribeURL is fetched and confirmation sent.
    process.env.SES_SNS_TOPIC_ARNS = TOPIC;
    const originalFetch = globalThis.fetch;
    let fetchedUrl: string | null = null;
    globalThis.fetch = (async (url: unknown) => {
      fetchedUrl = String(url);
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    try {
      const res2 = await post(sub());
      expect(res2.status).toBe(200);
      expect(((await res2.json()) as { confirmed: boolean }).confirmed).toBe(true);
      expect(fetchedUrl).toContain("Action=ConfirmSubscription");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.SES_SNS_TOPIC_ARNS;
    }
  });

  it("unknown SES event types are acknowledged but not applied", async () => {
    if (!(await reachable())) return;
    const id = await seedSent();
    const res = await post(
      envelope({ message: sesMsg(providerMessageIdOf(id), "awsaccountstatus") })
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: boolean }).applied).toBe(false);
  });
});
