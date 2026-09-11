import { z } from "zod";

// ── Email sending ────────────────────────────────────────────

export const sendEmailSchema = z
  .object({
    from: z.union([z.string().email().max(320), z.string().regex(/^sender_[A-Za-z0-9_-]{1,64}$/)], {
      errorMap: () => ({ message: "from must be an email address or a sender ID (sender_...)" }),
    }),
    to: z.string().email().max(320),
    cc: z.string().email().max(320).optional(),
    bcc: z.string().email().max(320).optional(),
    reply_to: z.string().email().max(320).optional(),
    subject: z.string().min(1).max(998),
    html: z.string().max(1_000_000).optional(),
    text: z.string().max(1_000_000).optional(),
    tags: z
      .array(z.object({ name: z.string().max(100), value: z.string().max(500) }))
      .max(20)
      .optional(),
    metadata: z.record(z.unknown()).optional(),
    headers: z.record(z.string().max(2000)).optional(),
  })
  .refine((d) => d.html !== undefined || d.text !== undefined, {
    message: "Either html or text must be provided",
    path: ["html"],
  });

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

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

export const templateAliasSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, "Alias must be lowercase alphanumeric and hyphens");

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
  ref: z
    .string()
    .regex(/^[A-Za-z0-9]{6,16}$/, "Invalid referral code")
    .optional(),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

// ── Environment validation ───────────────────────────────────

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function safeValidate<T>(schema: z.ZodType<T>, data: unknown) {
  return schema.safeParse(data);
}
