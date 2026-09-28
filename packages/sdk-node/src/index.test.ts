import { describe, it, expect, vi, afterEach } from "vitest";
import Calder, { CalderAuthError, CalderRateLimitError, CalderRequestError } from "./index.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clientWithMock(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init ?? {}))
  );
  const sdk = new Calder({ apiKey: "calder_sk_test_key123", fetchImpl, timeoutMs: 2_000 });
  return { sdk, fetchImpl };
}

afterEach(() => vi.restoreAllMocks());

describe("Calder emails.send", () => {
  it("posts with bearer auth, json body and an idempotency key", async () => {
    const { sdk, fetchImpl } = clientWithMock(() =>
      jsonResponse(200, { id: "em_1", status: "queued" })
    );
    const out = await sdk.emails.send({
      from: "app@acme.com",
      to: "you@example.com",
      subject: "hi",
      text: "body",
    });
    expect(out.id).toBe("em_1");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.calder.click/v1/emails");
    const headers = init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer calder_sk_test_key123");
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe("app@acme.com");
    expect(body.idempotencyKey).toBeUndefined(); // never leaks into payload
  });

  it("honors a caller-provided idempotency key", async () => {
    const { sdk, fetchImpl } = clientWithMock(() =>
      jsonResponse(200, { id: "em_2", status: "queued" })
    );
    await sdk.emails.send({
      from: "a@b.co",
      to: "c@d.co",
      subject: "s",
      html: "<p>x</p>",
      idempotencyKey: "order-123:confirm",
    });
    const headers = (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("order-123:confirm");
  });

  it("rejects incomplete input client-side with CalderRequestError", async () => {
    const { sdk } = clientWithMock(() => jsonResponse(200, {}));
    await expect(
      // @ts-expect-error — exercising runtime guard
      sdk.emails.send({ from: "a@b.co", subject: "s", text: "x" })
    ).rejects.toBeInstanceOf(CalderRequestError);
  });
});

describe("error mapping", () => {
  it("401/403 → CalderAuthError", async () => {
    const { sdk } = clientWithMock(() => jsonResponse(401, { error: "Invalid key." }));
    await expect(
      sdk.emails.send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" })
    ).rejects.toBeInstanceOf(CalderAuthError);
  });

  it("429 → CalderRateLimitError with Retry-After", async () => {
    const { sdk } = clientWithMock(() =>
      jsonResponse(429, { error: "Slow down." }, { "retry-after": "30" })
    );
    const err = await sdk.emails
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CalderRateLimitError);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("422 → CalderRequestError carrying the API message", async () => {
    const { sdk } = clientWithMock(() => jsonResponse(422, { error: "Domain not verified." }));
    const err = await sdk.emails
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CalderRequestError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Domain not verified.");
  });
});

describe("retries", () => {
  it("retries once on 500 and succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { sdk } = clientWithMock(() => {
      calls += 1;
      return calls === 1
        ? jsonResponse(500, { error: "boom" })
        : jsonResponse(200, { id: "em_ok", status: "queued" });
    });
    const p = sdk.emails.send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" });
    await vi.runAllTimersAsync();
    const out = await p;
    expect(out.id).toBe("em_ok");
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("never retries a 4xx", async () => {
    let calls = 0;
    const { sdk } = clientWithMock(() => {
      calls += 1;
      return jsonResponse(400, { error: "nope" });
    });
    await expect(
      sdk.emails.send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" })
    ).rejects.toBeInstanceOf(CalderRequestError);
    expect(calls).toBe(1);
  });

  it("retries once on network failure then throws", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { sdk } = clientWithMock(() => {
      calls += 1;
      throw new Error("socket hang up");
    });
    const p = sdk.emails
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" })
      .catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(calls).toBe(2);
    expect(String(err)).toContain("socket hang up");
    vi.useRealTimers();
  });
});

describe("reads", () => {
  // The API answers reads with its real envelopes: { data } for a single
  // email, { data, pagination.next_cursor } for a page. Mocking anything
  // flatter would hide exactly the drift these tests exist to catch.
  it("get unwraps { data } and fetches the encoded id", async () => {
    const { sdk, fetchImpl } = clientWithMock(() =>
      jsonResponse(200, { data: { id: "em_42", status: "delivered" } })
    );
    const got = await sdk.emails.get("em_42");
    expect(got.status).toBe("delivered");
    expect(got.id).toBe("em_42");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.calder.click/v1/emails/em_42");
  });

  it("list passes limit/cursor/status as query params and maps pagination", async () => {
    const { sdk, fetchImpl } = clientWithMock(() =>
      jsonResponse(200, {
        data: [{ id: "em_1", status: "sent" }],
        pagination: { limit: 25, next_cursor: "next_abc" },
      })
    );
    const page = await sdk.emails.list({ limit: 25, cursor: "abc", status: "delivered" });
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("limit=25");
    expect(url).toContain("cursor=abc");
    expect(url).toContain("status=delivered");
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBe("next_abc");
  });

  it("list tolerates an absent pagination block", async () => {
    const { sdk } = clientWithMock(() => jsonResponse(200, { data: [] }));
    const page = await sdk.emails.list();
    expect(page).toEqual({ data: [], nextCursor: null });
  });
});

describe("construction", () => {
  it("requires an API key (explicit or env)", () => {
    const prev = process.env.CALDER_API_KEY;
    delete process.env.CALDER_API_KEY;
    expect(() => new Calder()).toThrow(/API key/);
    if (prev !== undefined) process.env.CALDER_API_KEY = prev;
  });

  it("reads CALDER_API_KEY", () => {
    process.env.CALDER_API_KEY = "calder_sk_test_env";
    const sdk = new Calder();
    expect(sdk).toBeInstanceOf(Calder);
    delete process.env.CALDER_API_KEY;
  });
});

describe("email streams", () => {
  it("forwards an explicit marketing stream", async () => {
    const { sdk, fetchImpl } = clientWithMock(() =>
      jsonResponse(200, { id: "em_mkt", status: "queued" })
    );
    await sdk.emails.send({
      from: "updates@acme.com",
      stream: "marketing",
      to: "subscriber@example.com",
      subject: "News",
      text: "body",
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.stream).toBe("marketing");
  });

  it("leaves stream unset by default so the API keeps sends transactional", async () => {
    const { sdk, fetchImpl } = clientWithMock(() =>
      jsonResponse(200, { id: "em_txn", status: "queued" })
    );
    await sdk.emails.send({
      from: "app@acme.com",
      to: "you@example.com",
      subject: "Receipt",
      text: "body",
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.stream).toBeUndefined();
  });
});

describe("structured API error shape", () => {
  it("extracts message + code from { error: { code, message } }", async () => {
    const { sdk } = clientWithMock(() =>
      jsonResponse(422, { error: { code: "suppressed", message: "Recipient suppressed." } })
    );
    const err = await sdk.emails
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CalderRequestError);
    expect(err.message).toBe("Recipient suppressed.");
    expect(err.code).toBe("suppressed");
  });
});
