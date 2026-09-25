import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Throwaway self-signed cert so SNS signature verification runs for real. */
function makeSnsCert(): { certPem: string; keyPem: string } | null {
  const dir = join(tmpdir(), `sns-live-path-${process.pid}`);
  const cert = join(dir, "cert.pem");
  const key = join(dir, "key.pem");
  try {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(cert)) {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-nodes",
          "-subj",
          "/CN=sns.test.local",
        ],
        { stdio: "ignore" }
      );
    }
    return { certPem: readFileSync(cert, "utf8"), keyPem: readFileSync(key, "utf8") };
  } catch {
    return null;
  }
}

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The LIVE path, end to end, without AWS credentials.
 *
 * Everything above the network is the production code: resolveEmailProvider()
 * picks the real SES driver, the real AWS SDK signs and serialises the real
 * protocol, drain.ts runs the real chain/quota/ledger/retry logic. Only the
 * SES endpoint is local — the SDK honours AWS_ENDPOINT_URL (also the supported
 * way to point production at a VPC endpoint), so the wire payload, error
 * mapping and transient/permanent classification are all exercised for real.
 *
 * Why this exists: every other suite runs test-env rows, which short-circuit
 * to the mock provider. That leaves the path a paying customer actually uses
 * — SES ingest, metering, throttle recovery, hard-bounce retirement — proven
 * by nothing. These tests are that proof.
 */
gate("live send path against a real SES-protocol endpoint (no AWS)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, emails, usageRecords } =
    await import("@calder/db");
  const { eq, and, count } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");
  const { drainPendingEmails } = await import("../lib/drain.js");

  // ── Local SESv2 endpoint (REST-JSON, the protocol the SDK speaks) ──
  interface CapturedRequest {
    path: string;
    body: Record<string, unknown>;
  }
  const captured: CapturedRequest[] = [];
  /** How the endpoint answers the next SendEmail calls. */
  let mode: "ok" | "throttle" | "reject" = "ok";
  let sequence = 0;
  let server: Server;

  function sendResponse(): { status: number; headers: Record<string, string>; body: string } {
    if (mode === "throttle") {
      // The exact shape AWS returns when the account's rate is exceeded.
      return {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-amzn-errortype": "TooManyRequestsException",
        },
        body: JSON.stringify({ message: "Maximum sending rate exceeded." }),
      };
    }
    if (mode === "reject") {
      return {
        status: 400,
        headers: { "content-type": "application/json", "x-amzn-errortype": "MessageRejected" },
        body: JSON.stringify({ message: "Email address is not verified." }),
      };
    }
    sequence += 1;
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MessageId: `0100-live-${sequence}-${suffix}` }),
    };
  }

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_live_${suffix}`;
  const projId = `proj_live_${suffix}`;
  const userId = `usr_live_${suffix}`;
  const liveKey = `calder_live_${suffix}`;
  const domain = `live-${suffix}.test`;
  const from = `sender-${suffix}@test.test`;

  const app = createApp();

  async function waitForStatus(emailId: string, status: string, timeoutMs = 20_000) {
    const db = getDb();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
      if (row?.status === status) return row;
      if (Date.now() > deadline) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /**
   * The send route auto-kicks a drain, so a row can be claimed ("sending") by
   * another drain at the moment we look. Wait until no drain holds it before
   * asserting on its resting state.
   */
  async function waitUnclaimed(emailId: string, timeoutMs = 20_000) {
    const db = getDb();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
      if (row && row.status !== "sending") return row;
      if (Date.now() > deadline) return row;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function waitSettled(emailId: string, timeoutMs = 20_000) {
    const db = getDb();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
      if (row && (row.status === "sent" || row.status === "failed")) return row;
      if (Date.now() > deadline) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const post = (body: unknown) =>
    app.request("/v1/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${liveKey}` },
      body: JSON.stringify(body),
    });

  const savedEnv = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
  };

  beforeAll(async () => {
    if (!(await reachable())) return;
    // Stand up the fake SES endpoint before anything resolves a provider.
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
        captured.push({ path: req.url ?? "", body });

        if (req.url === "/v2/email/outbound-emails") {
          const r = sendResponse();
          res.writeHead(r.status, r.headers);
          res.end(r.body);
          return;
        }
        if (req.url === "/v2/email/identities") {
          // CreateEmailIdentity: three DKIM tokens for the domain.
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              IdentityType: "DOMAIN",
              VerifiedForSendingStatus: false,
              DkimAttributes: {
                Status: "PENDING",
                SigningEnabled: true,
                Tokens: [`tok1${suffix}`, `tok2${suffix}`, `tok3${suffix}`],
              },
            })
          );
          return;
        }
        if (req.url?.startsWith("/v2/email/identities/")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              IdentityType: "DOMAIN",
              VerifiedForSendingStatus: true,
              DkimAttributes: { Status: "SUCCESS", SigningEnabled: true },
            })
          );
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: `unhandled ${req.url}` }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    // Make the live path resolve the REAL SES driver against the local endpoint.
    process.env.AWS_ACCESS_KEY_ID = "AKIAINTEGRATIONTEST";
    process.env.AWS_SECRET_ACCESS_KEY = "integration-test-secret";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = `http://127.0.0.1:${port}`;

    const db = getDb();
    await db.insert(users).values({ id: userId, email: `live-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Live", slug: `live-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_${orgId}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(liveKey, {
      apiKeyId: `key_live_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "live",
    });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((r) => server?.close(() => r()));
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("delivers a live send through the real SES driver and records provider truth", async () => {
    const res = await post({
      from,
      to: `recipient-${suffix}@example.test`,
      subject: `Live proof ${suffix}`,
      html: "<p>live</p>",
      text: "live",
      headers: { "X-Campaign": "live-path" },
    });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };

    await drainPendingEmails(getDb(), { batch: 20 }).catch(() => {});
    const row = await waitSettled(id);

    // The delivered row carries real provider truth, not a mock's.
    expect(row?.status).toBe("sent");
    expect(row?.env).toBe("live");
    expect(row?.provider).toBe("ses");
    expect(row?.transport).toBe("default");
    expect(row?.providerMessageId).toMatch(new RegExp(`^0100-live-\\d+-${suffix}$`));

    // And the wire request was a real, correct SES SendEmail payload.
    // Match on our own sender: the drain is global, so a shared database can
    // legitimately carry other projects' queued live rows to the endpoint.
    const sent = captured.filter(
      (c) =>
        c.path === "/v2/email/outbound-emails" &&
        (c.body as { FromEmailAddress?: string }).FromEmailAddress === from
    );
    expect(sent).toHaveLength(1);
    const payload = sent[0]!.body as {
      FromEmailAddress: string;
      Destination: { ToAddresses: string[] };
      Content: {
        Simple: {
          Subject: { Data: string };
          Body: { Html?: { Data: string }; Text?: { Data: string } };
          Headers?: { Name: string; Value: string }[];
        };
      };
    };
    expect(payload.FromEmailAddress).toBe(from);
    expect(payload.Destination.ToAddresses).toEqual([`recipient-${suffix}@example.test`]);
    expect(payload.Content.Simple.Subject.Data).toBe(`Live proof ${suffix}`);
    expect(payload.Content.Simple.Body.Html?.Data).toBe("<p>live</p>");
    expect(payload.Content.Simple.Body.Text?.Data).toBe("live");
    expect(payload.Content.Simple.Headers).toEqual([{ Name: "X-Campaign", Value: "live-path" }]);
  });

  it("meters a live delivery exactly once, in the usage ledger", async () => {
    const db = getDb();
    const [row] = await db
      .select()
      .from(emails)
      .where(and(eq(emails.projectId, projId), eq(emails.status, "sent")))
      .limit(1);
    expect(row).toBeTruthy();

    const ledger = await db
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${row!.id}`));
    expect(Number(ledger[0]?.value ?? 0)).toBe(1);

    // Re-draining must not double-count a delivered row (exactly-once ledger).
    await drainPendingEmails(getDb(), { batch: 20 }).catch(() => {});
    const again = await db
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${row!.id}`));
    expect(Number(again[0]?.value ?? 0)).toBe(1);
  });

  it("treats SES throttling as transient: requeue, then deliver on retry", async () => {
    mode = "throttle";
    const res = await post({
      from,
      to: `throttled-${suffix}@example.test`,
      subject: "Throttled",
      text: "retry me",
    });
    const { id } = (await res.json()) as { id: string };

    await drainPendingEmails(getDb(), { batch: 20 }).catch(() => {});

    // Throttling must NOT burn the message: it goes back to the queue with the
    // provider's reason attached, attempts recorded.
    const requeued = await waitUnclaimed(id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.attemptCount).toBeGreaterThanOrEqual(1);
    expect(String(requeued?.lastError ?? "")).toMatch(/rate|throttl/i);

    // Recovery: the rate clears, the same row delivers without a re-send.
    mode = "ok";
    await drainPendingEmails(getDb(), { batch: 20 }).catch(() => {});
    const delivered = await waitSettled(id);
    expect(delivered?.status).toBe("sent");
    expect(delivered?.provider).toBe("ses");
  });

  it("fails a hard SES rejection permanently (no infinite retry)", async () => {
    mode = "reject";
    const res = await post({
      from,
      to: `rejected-${suffix}@example.test`,
      subject: "Rejected",
      text: "permanent",
    });
    const { id } = (await res.json()) as { id: string };

    await drainPendingEmails(getDb(), { batch: 20 }).catch(() => {});
    const row = await waitSettled(id);

    expect(row?.status).toBe("failed");
    expect(String(row?.lastError ?? "")).toMatch(/not verified|rejected/i);
    mode = "ok";
  });

  it("links a verified domain to SES and returns the DKIM records to publish", async () => {
    const { getDb: gdb, domains: domainsTable } = await import("@calder/db");
    const { attemptVerification } = await import("@calder/db");
    const db = gdb();

    // 1. Register the domain (challenge minted, nothing verified yet).
    const created = await app.request("/v1/domains", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${liveKey}` },
      body: JSON.stringify({ domain }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; verification: { host: string; value: string } };
    };
    const domainId = createdBody.data.id;
    expect(createdBody.data.verification.host).toBe(`_calder.${domain}`);

    // 2. Ownership check against the challenge the tenant would publish. The
    //    oracle is injectable by design; production uses system DNS then DoH.
    const verdict = await attemptVerification(db, projId, domainId, async () => [
      createdBody.data.verification.value,
    ]);
    expect(verdict.kind).toBe("verified");

    const [row] = await db
      .select()
      .from(domainsTable)
      .where(eq(domainsTable.id, domainId))
      .limit(1);
    expect(row?.status).toBe("verified");

    // 3. Attach the SES identity (real provider code, local endpoint).
    const linked = await app.request(`/v1/domains/${domainId}/ses/link`, {
      method: "POST",
      headers: { authorization: `Bearer ${liveKey}` },
    });
    expect(linked.status).toBe(200);
    const linkedBody = (await linked.json()) as {
      data: { dkim: { status: string; records: { name: string; type: string; value: string }[] } };
    };
    expect(linkedBody.data.dkim.status).toBe("PENDING");
    expect(linkedBody.data.dkim.records).toHaveLength(3);
    expect(linkedBody.data.dkim.records[0]!.name).toContain(`_domainkey.${domain}`);
    expect(linkedBody.data.dkim.records[0]!.type).toBe("CNAME");

    // Persisted for the dashboard/control plane, and the identity request was real.
    const [after] = await db
      .select()
      .from(domainsTable)
      .where(eq(domainsTable.id, domainId))
      .limit(1);
    expect(after?.sesIdentityStatus).toBe("pending");
    expect(captured.some((c) => c.path === "/v2/email/identities")).toBe(true);
  });

  it("refuses a live send from a sender identity that is not verified", async () => {
    const { getDb: gdb, senderIdentities } = await import("@calder/db");
    const db = gdb();
    const pendingSender = `pending-${suffix}@test.test`;
    await db.insert(senderIdentities).values({
      id: `snd_pending_${suffix}`,
      projectId: projId,
      email: pendingSender,
      displayName: "Pending",
      type: "domain",
      status: "pending",
    });

    const res = await post({
      from: pendingSender,
      to: `nobody-${suffix}@example.test`,
      subject: "From an unverified sender",
      text: "must not go out",
    });
    // A platform must not be able to send as an address it has not proven it
    // owns. This is the 422 the SDK surfaces as a typed error.
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("sender_not_ready");
    expect(body.error.message).toMatch(/verified|pending/i);
  });

  it("turns a real hard bounce into a suppression that stops the next send", async () => {
    const { getDb: gdb, suppressions } = await import("@calder/db");
    const { setSnsCertFetcher, snsStringToSign } = await import("../lib/ses-events.js");
    const db = gdb();
    const badAddress = `bouncer-${suffix}@example.test`;

    // 1. A real live send through SES, and the provider's own message id.
    const sent = await post({ from, to: badAddress, subject: "Will bounce", text: "void" });
    expect(sent.status).toBe(202);
    const { id } = (await sent.json()) as { id: string };
    await drainPendingEmails(getDb(), { batch: 20 }).catch(() => {});
    const delivered = await waitSettled(id);
    expect(delivered?.status).toBe("sent");
    const providerMessageId = delivered!.providerMessageId!;

    // 2. SES reports the hard bounce to SNS. Sign it exactly as SNS would and
    //    let the real verification path run (cert fetcher is the only seam).
    const fixture = makeSnsCert();
    if (!fixture) return; // openssl unavailable; covered by the ses-events suite
    setSnsCertFetcher(async () => fixture.certPem);
    const envelope = (message: unknown): Record<string, unknown> => {
      const env = {
        Type: "Notification",
        MessageId: `sns-${randomBytes(8).toString("hex")}`,
        TopicArn: "arn:aws:sns:us-east-1:000000000000:calder-ses-events",
        Message: JSON.stringify(message),
        Timestamp: new Date().toISOString(),
        SigningCertURL:
          "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-livepath.pem",
        SignatureVersion: "1",
        Signature: "UNSIGNED",
      };
      const signer = createSign("RSA-SHA1");
      signer.update(snsStringToSign(env as never), "utf8");
      return { ...env, Signature: signer.sign(fixture.keyPem, "base64") };
    };

    const bounceEvent = await app.request("/v1/ses/events", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(
        envelope({
          eventType: "Bounce",
          mail: {
            messageId: providerMessageId,
            timestamp: new Date().toISOString(),
            destination: [badAddress],
          },
          bounce: {
            bounceType: "Permanent",
            bounceSubType: "General",
            bouncedRecipients: [{ emailAddress: badAddress }],
          },
        })
      ),
    });
    expect(bounceEvent.status).toBe(200);
    setSnsCertFetcher(undefined);

    // 3. Delivery truth moved, and the address is suppressed for the project.
    const bounced = await waitForStatus(id, "bounced");
    expect(bounced?.status).toBe("bounced");
    const [sup] = await db
      .select()
      .from(suppressions)
      .where(and(eq(suppressions.projectId, projId), eq(suppressions.email, badAddress)))
      .limit(1);
    expect(sup?.reason).toBe("bounce");

    // 4. The customer's next send to that address is refused, never queued.
    const resend = await post({
      from,
      to: badAddress,
      subject: "Second attempt",
      text: "should be refused",
    });
    expect(resend.status).toBe(422);
    const body = (await resend.json()) as { error: { code: string } };
    expect(body.error.code).toBe("suppressed");
  }, 60_000);

  it("/ready refuses to claim ready when no provider credentials exist", async () => {
    // Production is the case that matters: a deploy with no SES credentials
    // can accept sends and deliver nothing. Readiness must say so.
    const saved = {
      nodeEnv: process.env.NODE_ENV,
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
    };
    process.env.NODE_ENV = "production";
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    try {
      const res = await app.request("/ready");
      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        status: string;
        checks: Record<string, { state: string }>;
      };
      expect(body.status).toBe("degraded");
      expect(body.checks.email_provider?.state).not.toBe("ok");
    } finally {
      process.env.NODE_ENV = saved.nodeEnv;
      if (saved.key !== undefined) process.env.AWS_ACCESS_KEY_ID = saved.key;
      if (saved.secret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = saved.secret;
    }
  });
});
