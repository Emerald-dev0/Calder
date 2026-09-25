import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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
    const sent = captured.filter((c) => c.path === "/v2/email/outbound-emails");
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

    const db = getDb();
    const [requeued] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    // Throttling must NOT burn the message: it goes back to the queue with the
    // provider's reason attached, attempts recorded.
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
});
