import { z } from "zod";

// ── Email sending ────────────────────────────────────────────

const aliasSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, "Alias must be lowercase alphanumeric and hyphens");

const senderRefSchema = z.union(
  [z.string().email().max(320), z.string().regex(/^sender_[A-Za-z0-9_-]{1,64}$/)],
  {
    errorMap: () => ({ message: "from must be an email address or a sender ID (sender_...)" }),
  }
);

const attachmentSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, "Filename cannot contain path separators"),
  contentType: z.string().max(127).optional(),
  contentBase64: z.string().min(1),
});

export const sendEmailSchema = z
  .object({
    from: senderRefSchema,
    // Separate reputational lanes: marketing must never silently share transactional defaults.
    stream: z.enum(["transactional", "marketing"]).default("transactional"),
    to: z.string().email().max(320),
    cc: z.string().email().max(320).optional(),
    bcc: z.string().email().max(320).optional(),
    reply_to: z.string().email().max(320).optional(),
    subject: z.string().min(1).max(998).optional(),
    html: z.string().max(1_000_000).optional(),
    text: z.string().max(1_000_000).optional(),
    tags: z
      .array(z.object({ name: z.string().max(100), value: z.string().max(500) }))
      .max(20)
      .optional(),
    metadata: z.record(z.unknown()).optional(),
    headers: z.record(z.string().max(2000)).optional(),
    attachments: z.array(attachmentSchema).max(10).optional(),
    scheduled_at: z.string().datetime({ offset: true }).optional(),
    template: aliasSchema.optional(),
    variables: z.record(z.string().max(100_000)).optional(),
  })
  .refine((d) => d.html !== undefined || d.text !== undefined || d.template !== undefined, {
    message: "Provide html, text, or a template alias",
    path: ["html"],
  })
  .refine((d) => d.subject !== undefined || d.template !== undefined, {
    message: "Provide a subject, or a template that supplies one",
    path: ["subject"],
  })
  .refine(
    (d) => {
      if (!d.attachments || d.attachments.length === 0) return true;
      const total = d.attachments.reduce((n, a) => n + a.contentBase64.length, 0);
      // base64 inflates ~4/3: 25MB on the wire ≈ 18MB of files
      return total <= 25 * 1024 * 1024;
    },
    { message: "Attachments exceed 25 MB of base64 in total", path: ["attachments"] }
  )
  .refine(
    (d) => {
      if (!d.scheduled_at) return true;
      const at = new Date(d.scheduled_at).getTime();
      const now = Date.now();
      return at > now && at - now <= 366 * 24 * 60 * 60 * 1000;
    },
    { message: "scheduled_at must be in the future, at most a year ahead", path: ["scheduled_at"] }
  );

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// Bulk: up to 100 messages, one shared idempotency base in the header.
export const bulkSendSchema = z.object({
  from: senderRefSchema,
  stream: z.enum(["transactional", "marketing"]).default("transactional"),
  messages: z
    .array(
      z.object({
        to: z.string().email().max(320),
        subject: z.string().min(1).max(998).optional(),
        html: z.string().max(1_000_000).optional(),
        text: z.string().max(1_000_000).optional(),
        template: aliasSchema.optional(),
        variables: z.record(z.string().max(100_000)).optional(),
      })
    )
    .min(1)
    .max(100),
  subject: z.string().min(1).max(998).optional(),
  html: z.string().max(1_000_000).optional(),
  text: z.string().max(1_000_000).optional(),
  template: aliasSchema.optional(),
  variables: z.record(z.string().max(100_000)).optional(),
});

export type BulkSendInput = z.infer<typeof bulkSendSchema>;

// ── Domain ───────────────────────────────────────────────────

export const createDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid domain format")
    .transform((v) => v.toLowerCase()),
});

export type CreateDomainInput = z.infer<typeof createDomainSchema>;

// ── Project ──────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric and hyphens"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ── Pagination ───────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

/** Cursor pagination: opaque cursor (created_at + id), forward-only. */
export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;

// ── Senders ──────────────────────────────────────────────────

export const senderTypeSchema = z.enum(["domain", "gmail", "managed"]);

export const createSenderSchema = z.object({
  display_name: z.string().min(2).max(255),
  email: z.string().email().max(320),
  type: senderTypeSchema,
  transport_id: z.string().max(100).optional(),
});

export type CreateSenderInput = z.infer<typeof createSenderSchema>;

export const patchSenderSchema = z
  .object({
    display_name: z.string().min(2).max(255).optional(),
    is_default: z.boolean().optional(),
  })
  .refine((d) => d.display_name !== undefined || d.is_default !== undefined, {
    message: "Nothing to update: send display_name and/or is_default",
  });

// ── API keys ─────────────────────────────────────────────────

export const keyScopeSchema = z.enum(["full", "send", "read"]);

export const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  env: z.enum(["test", "live"]),
  scope: keyScopeSchema.default("full"),
});

export type CreateKeyInput = z.infer<typeof createKeySchema>;

// ── Templates ────────────────────────────────────────────────

export const templateAliasSchema = aliasSchema;

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  alias: templateAliasSchema.optional(),
  description: z.string().max(2000).optional(),
  subject: z.string().max(998).optional(),
  html: z.string().max(1_000_000).optional(),
  text: z.string().max(1_000_000).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const createTemplateVersionSchema = z.object({
  subject: z.string().max(998).optional(),
  html: z.string().max(1_000_000).optional(),
  text: z.string().max(1_000_000).optional(),
});

// ── Suppressions ─────────────────────────────────────────────

export const createSuppressionSchema = z.object({
  email: z.string().email().max(320),
  reason: z.string().min(1).max(100),
});

// ── Webhook ──────────────────────────────────────────────────

export const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.string()).min(1),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

// ── Waitlist ───────────────────────────────────────────────────

export const joinWaitlistSchema = z.object({
  email: z
    .string()
    .email()
    .max(320)
    .transform((v) => v.toLowerCase().trim()),
  first_name: z
    .string()
    .max(255)
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, "First name can't be empty")
    .optional(),
  ref: z
    .string()
    .regex(/^[A-Za-z0-9]{6,16}$/, "Invalid referral code")
    .optional(),
  // Acquisition context declared by the page/form (see DEC-007). Stored on
  // the signup row; country is separately derived server-side from geo.
  source: z.string().max(100).optional(),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

// ── Analytics beacon ─────────────────────────────────────────

/**
 * First-party analytics events. Privacy by construction: the schema only
 * accepts the anonymous, non-identifying fields below — anything else a
 * client sends is stripped. No emails, names, IPs, or free text (REQ-080).
 */
const beaconEventSchema = z
  .object({
    type: z.enum(["pageview", "cta_click", "form_start", "form_complete"]),
    path: z.string().max(512).optional(),
    label: z.string().max(100).optional(),
    referrer: z.string().max(512).optional(),
    source: z.string().max(100).optional(),
    utm: z.record(z.string().max(200)).optional(),
    sessionId: z.string().min(8).max(64),
    visitorId: z.string().min(8).max(64),
    device: z.enum(["desktop", "mobile", "tablet"]).optional(),
  })
  .strict();

export const beaconBatchSchema = z
  .object({
    events: z.array(beaconEventSchema).min(1).max(20),
  })
  .strict();

export type BeaconBatchInput = z.infer<typeof beaconBatchSchema>;

// ── Environment validation ───────────────────────────────────

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function safeValidate<T>(schema: z.ZodType<T>, data: unknown) {
  return schema.safeParse(data);
}
