import { beforeEach, describe, expect, it, vi } from "vitest";

// Test env: a stable secret for preference tokens, and no AWS credentials so
// `resolveEmailProvider` returns the mock provider.
process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.NODE_ENV;

const sent: Array<Record<string, unknown>> = [];
let failNext = false;

vi.mock("@calder/providers", () => ({
  resolveEmailProvider: () => ({
    driver: "mock",
    deliverable: true,
    reason: null,
    warnings: [],
    provider: {
      name: "mock",
      send: async (message: Record<string, unknown>) => {
        if (failNext) {
          const err = new Error("boom") as Error & { code: string };
          err.code = "MessageRejected";
          throw err;
        }
        sent.push(message);
        return { providerMessageId: `mock_${sent.length}`, provider: "mock", accepted: true };
      },
    },
  }),
}));

const { deliver } = await import("./send.js");
const { signPreferenceToken, verifyPreferenceToken } = await import("./tokens.js");
const { defaultUrls } = await import("./render/render.js");

import type { ClaimCompanyEmail, CompanyEmailStore, CompanyEmailRecord } from "./store.js";

interface MemoryStore extends CompanyEmailStore {
  rows: Map<string, ClaimCompanyEmail & { status: string; skipReason: string | null }>;
}

function memoryStore(initial: { disabled?: string[] } = {}): MemoryStore {
  const rows = new Map<string, ClaimCompanyEmail & { status: string; skipReason: string | null }>();
  const disabled = initial.disabled ?? [];

  return {
    rows,
    async claim(row) {
      if (rows.has(row.idempotencyKey)) return null;
      rows.set(row.idempotencyKey, { ...row });
      return { id: row.id };
    },
    async findByKey(key): Promise<CompanyEmailRecord | null> {
      const row = rows.get(key);
      return row
        ? {
            id: row.id,
            status: row.status as CompanyEmailRecord["status"],
            skipReason: row.skipReason,
          }
        : null;
    },
    async finish(id, patch) {
      for (const row of rows.values()) {
        if (row.id === id) row.status = patch.status;
      }
    },
    async disabledCategories() {
      return disabled;
    },
  };
}

const urls = defaultUrls({
  app: "https://calder.click",
  dashboard: "https://app.calder.click",
  preferences: "https://app.calder.click/settings/notifications",
  support: "mailto:support@calder.click",
});

beforeEach(() => {
  sent.length = 0;
  failNext = false;
});

describe("deliver", () => {
  it("sends once, records `sent`, and replays the same key without sending again", async () => {
    const store = memoryStore();
    const params = {
      id: "organization.invitation" as const,
      to: "Ada@Example.com",
      userId: "user_1",
      organizationId: "org_1",
      data: {
        inviterName: "Grace",
        organizationName: "Analytical Engines",
        role: "admin",
        acceptUrl: "https://app.calder.click/invite/abc",
        code: "123456",
      },
      urls,
      idempotencyKey: "invite:inv_1",
    };

    const first = await deliver(store, params);
    expect(first).toMatchObject({ status: "sent", replay: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.com");

    // The verification code is never persisted.
    const row = store.rows.get("invite:inv_1")!;
    expect(row.metadata).not.toHaveProperty("code");
    expect(row.metadata).toMatchObject({ role: "admin", inviterName: "Grace" });

    const second = await deliver(store, params);
    expect(second).toMatchObject({ status: "sent", replay: true });
    expect(sent).toHaveLength(1);
  });

  it("records a skip for an opt-out instead of sending", async () => {
    const store = memoryStore({ disabled: ["updates"] });
    const result = await deliver(store, {
      id: "updates.product_update",
      to: "ada@example.com",
      userId: "user_1",
      data: { title: "New thing", body: "It shipped" },
      urls,
      idempotencyKey: "update:2026-10",
    });
    expect(result).toMatchObject({ status: "skipped", skipReason: "opted_out" });
    expect(store.rows.get("update:2026-10")!.status).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("ignores an opt-out for a mandatory category", async () => {
    const store = memoryStore({ disabled: ["billing"] });
    const result = await deliver(store, {
      id: "billing.payment_failed",
      to: "ada@example.com",
      userId: "user_1",
      data: { amount: "₦5,000", planName: "Builder" },
      urls,
      idempotencyKey: "billing:inv_fail_1",
    });
    expect(result.status).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("skips an address that cannot be a mailbox without claiming a provider call", async () => {
    const store = memoryStore();
    const result = await deliver(store, {
      id: "account.welcome",
      to: "not-an-email",
      urls,
      idempotencyKey: "welcome:user_9",
    });
    expect(result).toMatchObject({ status: "skipped", skipReason: "invalid_recipient" });
    expect(sent).toHaveLength(0);
  });

  it("records a provider failure and reports it instead of throwing", async () => {
    failNext = true;
    const store = memoryStore();
    const result = await deliver(store, {
      id: "account.new_sign_in",
      to: "ada@example.com",
      userId: "user_1",
      data: { when: "now", ip: "1.2.3.4" },
      urls,
      idempotencyKey: "signin:sess_1",
    });
    expect(result.status).toBe("failed");
    const row = store.rows.get("signin:sess_1")!;
    expect(row.status).toBe("failed");
  });

  it("adds one-click unsubscribe headers only for opt-out categories", async () => {
    const store = memoryStore();

    await deliver(store, {
      id: "updates.monthly_digest",
      to: "ada@example.com",
      userId: "user_1",
      data: { period: "March", sent: 1200 },
      urls,
      idempotencyKey: "digest:2026-03",
    });
    const digest = sent[0] as { headers?: Record<string, string>; html: string };
    expect(digest.headers?.["List-Unsubscribe"]).toMatch(
      /^<https:\/\/calder\.click\/api\/unsubscribe\/company\?token=/
    );
    expect(digest.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(digest.html).toContain("Unsubscribe");

    await deliver(store, {
      id: "account.password_reset_code",
      to: "ada@example.com",
      userId: "user_1",
      data: { code: "111222", expiresInMinutes: 10 },
      urls,
      idempotencyKey: "reset:user_1:1",
    });
    const reset = sent[1] as { headers?: Record<string, string>; html: string };
    expect(reset.headers).toBeUndefined();
    expect(reset.html).not.toContain("Unsubscribe");
  });

  it("fails loudly on an id that is not in the catalogue", async () => {
    const store = memoryStore();
    await expect(
      deliver(store, {
        id: "billing.typo" as never,
        to: "ada@example.com",
        urls,
        idempotencyKey: "x:1",
      })
    ).rejects.toThrow(/Unknown company email/);
  });
});

describe("preference tokens", () => {
  it("round-trips a user and category", () => {
    const token = signPreferenceToken("user_1", "updates");
    expect(verifyPreferenceToken(token)).toEqual({ userId: "user_1", category: "updates" });
  });

  it("rejects a tampered token", () => {
    const token = signPreferenceToken("user_1", "updates");
    expect(verifyPreferenceToken(`${token}x`)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "user_2", c: "updates" }), "utf8").toString(
      "base64url"
    );
    expect(verifyPreferenceToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyPreferenceToken(payload!)).toBeNull();
  });
});
