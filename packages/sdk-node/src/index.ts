/**
 * Calder Node.js SDK — official client for https://api.calder.click/v1.
 *
 * Design rules (mirrors the API, nothing more):
 * - Sends are idempotent by DEFAULT: a UUID is generated per call unless you
 *   pass your own `idempotencyKey`; safe retries must never double-send.
 * - One 5xx/429 retry with jittered backoff; 4xx never retries.
 * - Errors surface as typed classes carrying status + API error string.
 * - Zero dependencies: built on globalThis.fetch (Node ≥ 18.17).
 */

export interface CalderClientOptions {
  /** API key — `calder_sk_live_…` / `calder_sk_test_…`, or set CALDER_API_KEY. */
  apiKey?: string;
  /** Override for tests / self-hosted installs. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 10_000). */
  timeoutMs?: number;
  /** fetch-compatible implementation (default: globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

export interface SendEmailInput {
  /** Verified sender, e.g. "app@yourdomain.com" (or `sender_…` id). */
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Custom headers — allowlisted (X-*, List-Unsubscribe*). */
  headers?: Record<string, string>;
  /** Your own idempotency key; generated UUID when omitted. */
  idempotencyKey?: string;
  /** Structured metadata carried on the delivery record. */
  metadata?: Record<string, unknown>;
}

export interface SentEmail {
  id: string;
  status: string;
}

export interface CalderEmail {
  id: string;
  status: string;
  from: string;
  to: string;
  subject: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface ListEmailsOptions {
  limit?: number;
  cursor?: string;
  status?: string;
}

export interface ListEmailsResult {
  data: CalderEmail[];
  nextCursor: string | null;
}

export class CalderError extends Error {
  readonly status: number;
  /** Machine-readable Calder error code when the API sent one. */
  readonly code?: string;
  readonly body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "CalderError";
    this.status = status;
    this.body = body;
    if (body && typeof body === "object" && "error" in body) {
      const e = (body as { error?: unknown }).error;
      if (e && typeof e === "object" && "code" in e && typeof (e as { code?: unknown }).code === "string") {
        this.code = (e as { code: string }).code;
      }
    }
  }
}

/** Bad key, missing scope — never retried. */
export class CalderAuthError extends CalderError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
    this.name = "CalderAuthError";
  }
}

/** Rate-limited / quota exceeded — surfaces Retry-After when present. */
export class CalderRateLimitError extends CalderError {
  readonly retryAfterMs?: number;
  constructor(message: string, retryAfterSec?: number, body?: unknown) {
    super(message, 429, body);
    this.name = "CalderRateLimitError";
    this.retryAfterMs = retryAfterSec !== undefined ? retryAfterSec * 1000 : undefined;
  }
}

/** 4xx other than 401/429 — caller's request is wrong; never retried. */
export class CalderRequestError extends CalderError {
  constructor(message: string, status: number, body?: unknown) {
    super(message, status, body);
    this.name = "CalderRequestError";
  }
}

const DEFAULT_BASE_URL = "https://api.calder.click";

function backoffMs(attempt: number): number {
  // attempt 1 → ~250–500ms
  return 250 * attempt + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    // Public API shape: { error: { code, message } }; dashboard-era routes
    // used a flat string — accept both, public shape wins.
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
    if (typeof err === "string" && err.length > 0) return err;
  }
  return fallback;
}

export class Calder {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  readonly emails: EmailsResource;

  constructor(options: CalderClientOptions = {}) {
    const key = options.apiKey ?? process.env.CALDER_API_KEY;
    if (!key) {
      throw new Error(
        "Calder SDK: no API key. Pass { apiKey } or set CALDER_API_KEY. Keys live in the dashboard → Keys."
      );
    }
    this.apiKey = key;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("Calder SDK requires fetch (Node ≥ 18.17) or `fetchImpl`.");
    }
    this.emails = new EmailsResource(this);
  }

  /** Internal transport. Retries 5xx/429 once with backoff; 4xx never. */
  async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined>; idempotencyKey?: string } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

    const maxAttempts = 2;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        // Network failure/timeout is retryable once.
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timer);
      }

      let body: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (res.ok) return body as T;

      const message = errorMessageFromBody(body, `Calder API error ${res.status}`);
      if (res.status === 401 || res.status === 403) throw new CalderAuthError(message, body);
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        throw new CalderRateLimitError(
          message,
          retryAfter ? Number(retryAfter) : undefined,
          body
        );
      }
      if (res.status >= 500) {
        lastError = new CalderError(message, res.status, body);
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      throw new CalderRequestError(message, res.status, body);
    }
    throw lastError ?? new Error("Calder request failed.");
  }
}

export class EmailsResource {
  constructor(private readonly client: Calder) {}

  /**
   * Send one transactional email. Idempotent by default: one generated UUID
   * per call; pass `input.idempotencyKey` to bind retries across processes
   * (e.g. `${orderId}:confirmation`).
   */
  async send(input: SendEmailInput): Promise<SentEmail> {
    if (!input.from || !input.to || !input.subject) {
      throw new CalderRequestError("send() requires from, to and subject.", 400);
    }
    if (!input.text && !input.html) {
      throw new CalderRequestError("send() requires text or html content.", 400);
    }
    const { idempotencyKey, ...body } = input;
    return this.client.request<SentEmail>("POST", "/v1/emails", {
      body,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    });
  }

  /** Retrieve one email with its delivery state. */
  async get(id: string): Promise<CalderEmail> {
    return this.client.request<CalderEmail>("GET", `/v1/emails/${encodeURIComponent(id)}`);
  }

  /** List recent emails for the key's project. */
  async list(options: ListEmailsOptions = {}): Promise<ListEmailsResult> {
    return this.client.request<ListEmailsResult>("GET", "/v1/emails", {
      query: {
        limit: options.limit !== undefined ? String(options.limit) : undefined,
        cursor: options.cursor,
        status: options.status,
      },
    });
  }
}

export default Calder;
