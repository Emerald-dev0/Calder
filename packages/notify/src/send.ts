import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getConfig } from "@calder/config";
import { companyEmails, type DbClient } from "@calder/db";
import { brandEmail, createEmailService } from "@calder/email";
import { logger } from "@calder/observability";
import { resolveEmailProvider } from "@calder/providers";
import { companyEmailDefinition, isOptionalCategory, type CompanyEmailId } from "./catalogue.js";
import { defaultUrls, renderCompanyEmail } from "./render/render.js";
import type { RenderUrls } from "./render/templates.js";
import { drizzleCompanyEmailStore, type CompanyEmailStore } from "./store.js";
import { signPreferenceToken } from "./tokens.js";

/**
 * Delivery for Calder's own mail.
 *
 * The order here is the design:
 *
 *  1. Is this person opted out? Optional categories only — and the answer is
 *     `skipped`, recorded, not a silent return, because support needs to be able
 *     to say "we did not send it".
 *  2. Render. Throws before anything is written if the catalogue id is wrong.
 *  3. Claim the idempotency key. The unique index decides who wins, so two
 *     concurrent retries cannot both send.
 *  4. Send through the provider directly. Company mail does not go through the
 *     customer send path: it must not consume the internal tenant's allowance,
 *     enter the customer's message log, or inherit their suppression rules.
 *  5. Write the outcome back onto the claimed row.
 *
 * A failure to send never throws to the caller. A missing verification email is
 * bad; a signup that 500s because the mail provider is down is worse.
 */

export type CompanyEmailStatus = "queued" | "sent" | "failed" | "skipped";
export type CompanyEmailSkipReason = "opted_out" | "duplicate" | "invalid_recipient" | "no_provider";

export interface SendCompanyEmailParams {
  /** Catalogue id. A typo fails here, before anything is sent. */
  id: CompanyEmailId;
  to: string;
  /** Needed for preferences and account history; optional for pure notices. */
  userId?: string | null;
  organizationId?: string | null;
  data?: Record<string, unknown>;
  /**
   * Caller-supplied key for the event, e.g. `invite:inv_123`. Make it
   * event-shaped, never random: a random key defeats idempotency entirely.
   */
  idempotencyKey: string;
  urls?: Partial<RenderUrls>;
  replyTo?: string;
}

export interface SendCompanyEmailResult {
  status: CompanyEmailStatus;
  id: string;
  /** True when the row already existed and nothing was sent again. */
  replay: boolean;
  skipReason?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Field names that must never reach `metadata`: codes, links, secrets. */
const SENSITIVE_KEY = /(code|token|secret|password|url|link)/i;

function safeMetadata(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.length > 200) continue;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Provider errors can name the recipient or the transport. Keep the class only. */
function scrubError(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    return `provider_error:${(err as { code: string }).code}`;
  }
  return "provider_error";
}

function defaultFrom(): string {
  const configured = getConfig().AUTH_EMAIL_FROM;
  return configured && configured.includes("@") ? configured : "Calder <hello@calder.click>";
}

/** Injectable so tests can send through the mock without touching env vars. */
export interface SendCompanyEmailDeps {
  store?: CompanyEmailStore;
  now?: () => Date;
}

export async function sendCompanyEmail(
  db: DbClient,
  params: SendCompanyEmailParams,
  deps: SendCompanyEmailDeps = {}
): Promise<SendCompanyEmailResult> {
  return deliver(deps.store ?? drizzleCompanyEmailStore(db), params, deps);
}

export async function deliver(
  store: CompanyEmailStore,
  params: SendCompanyEmailParams,
  deps: SendCompanyEmailDeps = {}
): Promise<SendCompanyEmailResult> {
  const definition = companyEmailDefinition(params.id);
  if (!definition) throw new Error(`Unknown company email: ${params.id}`);
  if (!params.idempotencyKey || params.idempotencyKey.length > 255) {
    throw new Error("sendCompanyEmail requires an idempotency key of 1-255 characters");
  }

  const to = params.to.trim().toLowerCase();
  const urls = defaultUrls(params.urls);
  const rowId = `cmail_${randomUUID()}`;

  const skip = async (
    reason: CompanyEmailSkipReason,
    subject: string
  ): Promise<SendCompanyEmailResult> => {
    const claimed = await store.claim({
      id: rowId,
      toEmail: to.slice(0, 320),
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      template: params.id,
      category: definition.category,
      subject: subject.slice(0, 500),
      status: "skipped",
      skipReason: reason,
      idempotencyKey: params.idempotencyKey,
      metadata: safeMetadata(params.data),
    });
    if (!claimed) return replay(store, params.idempotencyKey, rowId);
    return { status: "skipped", id: claimed.id, replay: false, skipReason: reason };
  };

  // 1. Address sanity and consent, cheapest first.
  if (!EMAIL_RE.test(to)) {
    return skip("invalid_recipient", `invalid_recipient:${params.id}`);
  }

  if (isOptionalCategory(definition.category) && params.userId) {
    const disabled = await store.disabledCategories(params.userId);
    if (disabled.includes(definition.category)) {
      return skip("opted_out", `opted_out:${params.id}`);
    }
  }

  // 2. Render before claiming, so a template error does not burn the key.
  const unsubscribeUrl =
    isOptionalCategory(definition.category) && params.userId
      ? `${urls.app.replace(/\/$/, "")}/api/unsubscribe/company?token=${signPreferenceToken(
          params.userId,
          definition.category
        )}`
      : undefined;

  const rendered = renderCompanyEmail({
    id: params.id,
    data: params.data,
    urls,
    unsubscribeUrl,
  });

  // 3. Claim the key.
  const claimed = await store.claim({
    id: rowId,
    toEmail: to,
    userId: params.userId ?? null,
    organizationId: params.organizationId ?? null,
    template: params.id,
    category: definition.category,
    subject: rendered.subject.slice(0, 500),
    status: "queued",
    skipReason: null,
    idempotencyKey: params.idempotencyKey,
    metadata: safeMetadata(params.data),
  });
  if (!claimed) return replay(store, params.idempotencyKey, rowId);

  // 4. Send. Company mail goes straight to the provider, outside the customer pipeline.
  let providerName: string | null = null;
  try {
    const status = resolveEmailProvider();
    providerName = status.provider.name;
    if (!status.deliverable) {
      logger.warn(
        { template: params.id, driver: status.driver, reason: status.reason },
        "Company email is NOT deliverable: no real provider configured"
      );
    }
    const service = createEmailService(status.provider);
    const headers: Record<string, string> = {};
    if (unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    const result = await service.send({
      from: defaultFrom(),
      to,
      subject: rendered.subject,
      html: brandEmail(rendered.html, {
        preheader: rendered.subject,
        unsubscribeUrl,
        unsubscribeReason: rendered.unsubscribable ? "You asked for Calder product news." : undefined,
      }),
      text: rendered.text,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      replyTo: params.replyTo,
      stream: "transactional",
    });

    await store.finish(claimed.id, {
      status: result.accepted ? "sent" : "failed",
      provider: result.provider,
      providerMessageId: result.providerMessageId.slice(0, 255),
      sentAt: result.accepted ? (deps.now?.() ?? new Date()) : null,
      error: result.accepted ? null : "provider_rejected",
    });

    return { status: result.accepted ? "sent" : "failed", id: claimed.id, replay: false };
  } catch (err) {
    const scrubbed = scrubError(err);
    await store.finish(claimed.id, {
      status: "failed",
      provider: providerName,
      error: scrubbed,
      sentAt: null,
    });
    logger.warn({ template: params.id, error: scrubbed }, "Company email failed to send");
    return { status: "failed", id: claimed.id, replay: false };
  }
}

async function replay(
  store: CompanyEmailStore,
  idempotencyKey: string,
  fallbackId: string
): Promise<SendCompanyEmailResult> {
  const existing = await store.findByKey(idempotencyKey);
  return {
    status: existing?.status ?? "skipped",
    id: existing?.id ?? fallbackId,
    replay: true,
    skipReason: existing?.skipReason ?? "duplicate",
  };
}

/**
 * `sendCompanyEmail` for call sites where mail is a side effect of something
 * more important (signup, invite, payment webhook). Swallows errors: the caller
 * already succeeded and must not be rolled back because an inbox is unreachable.
 */
export async function sendCompanyEmailQuietly(
  db: DbClient,
  params: SendCompanyEmailParams
): Promise<SendCompanyEmailResult | null> {
  try {
    return await sendCompanyEmail(db, params);
  } catch (err) {
    logger.warn(
      { template: params.id, err: err instanceof Error ? err.message : "unknown" },
      "Company email skipped after error"
    );
    return null;
  }
}

/** Account surface: the mail we have sent this person, newest first. */
export async function listCompanyEmailsForUser(db: DbClient, userId: string, limit = 50) {
  return db
    .select({
      id: companyEmails.id,
      template: companyEmails.template,
      category: companyEmails.category,
      subject: companyEmails.subject,
      status: companyEmails.status,
      sentAt: companyEmails.sentAt,
      createdAt: companyEmails.createdAt,
    })
    .from(companyEmails)
    .where(eq(companyEmails.userId, userId))
    .orderBy(desc(companyEmails.createdAt))
    .limit(limit);
}
