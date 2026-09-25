export type CalderError = { code?: string; message: string; request_id?: string };
export type EmailRequest = { from: string; to: string; subject: string; html?: string; text?: string; cc?: string; bcc?: string; reply_to?: string; metadata?: Record<string, unknown> };
export type EmailResponse = { id: string; status: string; [key: string]: unknown };

export class CalderApiError extends Error {
  readonly status: number;
  readonly details?: CalderError;
  constructor(status: number, details?: CalderError) {
    super(details?.message ?? `Calder API request failed (${status})`);
    this.name = "CalderApiError";
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = { idempotencyKey?: string; signal?: AbortSignal };

export class Calder {
  private readonly baseUrl: string;
  constructor(private readonly apiKey: string, options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    if (!apiKey) throw new Error("Calder API key is required");
    this.baseUrl = (options.baseUrl ?? "https://api.calder.click").replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
  }
  private readonly fetcher: typeof fetch;

  async request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers, signal: options.signal });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) throw new CalderApiError(response.status, body?.error);
    return body?.data ?? body;
  }

  emails = {
    send: (email: EmailRequest, options?: RequestOptions) => this.request<EmailResponse>("/v1/emails", { method: "POST", body: JSON.stringify(email) }, options),
    get: (id: string, options?: RequestOptions) => this.request<EmailResponse>(`/v1/emails/${encodeURIComponent(id)}`, {}, options),
  };
  domains = {
    list: (options?: RequestOptions) => this.request<Array<Record<string, unknown>>>("/v1/domains", {}, options),
    create: (domain: string, options?: RequestOptions) => this.request<Record<string, unknown>>("/v1/domains", { method: "POST", body: JSON.stringify({ domain }) }, options),
    verify: (id: string, options?: RequestOptions) => this.request<Record<string, unknown>>(`/v1/domains/${encodeURIComponent(id)}/verify`, { method: "POST" }, options),
  };
  webhooks = {
    list: (options?: RequestOptions) => this.request<Array<Record<string, unknown>>>("/v1/webhooks", {}, options),
  };
}

export default Calder;
