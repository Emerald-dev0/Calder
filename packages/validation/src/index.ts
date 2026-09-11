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
