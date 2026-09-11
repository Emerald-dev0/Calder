import { describe, it, expect } from "vitest";
import {
  sendEmailSchema,
  createDomainSchema,
  createSenderSchema,
  createKeySchema,
  createTemplateSchema,
  createSuppressionSchema,
  keyScopeSchema,
  bulkSendSchema,
} from "./index";

describe("validation schemas", () => {
  it("sendEmailSchema accepts valid input", () => {
    const result = sendEmailSchema.safeParse({
      from: "test@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
    });
    expect(result.success).toBe(true);
  });

  it("sendEmailSchema rejects missing html and text", () => {
    const result = sendEmailSchema.safeParse({
      from: "test@example.com",
      to: "recipient@example.com",
      subject: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("createDomainSchema validates domain format", () => {
    expect(createDomainSchema.safeParse({ domain: "example.com" }).success).toBe(true);
    expect(createDomainSchema.safeParse({ domain: "not a domain" }).success).toBe(false);
  });

  it("sendEmailSchema accepts sender IDs in from", () => {
    const ok = sendEmailSchema.safeParse({
      from: "sender_abc123",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Hi",
    });
    expect(ok.success).toBe(true);
    const bad = sendEmailSchema.safeParse({
      from: "not-an-email-or-sender",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Hi",
    });
    expect(bad.success).toBe(false);
  });

  it("createSenderSchema requires type-appropriate fields", () => {
    expect(
      createSenderSchema.safeParse({ display_name: "A", email: "a@x.com", type: "domain" }).success
    ).toBe(false);
    expect(
      createSenderSchema.safeParse({ display_name: "Calder", email: "a@x.com", type: "domain" })
        .success
    ).toBe(true);
    expect(
      createSenderSchema.safeParse({ display_name: "Calder", email: "bad", type: "domain" }).success
    ).toBe(false);
  });

  it("createKeySchema scopes and envs", () => {
    expect(createKeySchema.safeParse({ name: "k", env: "live", scope: "send" }).success).toBe(true);
    expect(createKeySchema.safeParse({ name: "k", env: "live", scope: "root" }).success).toBe(
      false
    );
    expect(keyScopeSchema.safeParse("full").success).toBe(true);
  });

  it("createTemplateSchema aliases and suppression emails", () => {
    expect(createTemplateSchema.safeParse({ name: "W", alias: "Bad Alias!" }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ name: "W", alias: "welcome" }).success).toBe(true);
    expect(createSuppressionSchema.safeParse({ email: "x@y.com", reason: "manual" }).success).toBe(
      true
    );
  });

  it("template-only sends pass without inline subject/body", () => {
    const ok = sendEmailSchema.safeParse({
      from: "a@x.com",
      to: "b@x.com",
      template: "welcome",
      variables: { name: "Ada" },
    });
    expect(ok.success).toBe(true);
    const bad = sendEmailSchema.safeParse({ from: "a@x.com", to: "b@x.com" });
    expect(bad.success).toBe(false);
  });

  it("attachments enforce count, names, and total size", () => {
    const base = { from: "a@x.com", to: "b@x.com", subject: "S", text: "T" };
    expect(
      sendEmailSchema.safeParse({
        ...base,
        attachments: [{ filename: "a.pdf", contentBase64: "aGk=" }],
      }).success
    ).toBe(true);
    expect(
      sendEmailSchema.safeParse({
        ...base,
        attachments: [{ filename: "../evil.pdf", contentBase64: "aGk=" }],
      }).success
    ).toBe(false);
    expect(
      sendEmailSchema.safeParse({
        ...base,
        attachments: Array.from({ length: 11 }, (_, i) => ({
          filename: `f${i}.pdf`,
          contentBase64: "aGk=",
        })),
      }).success
    ).toBe(false);
  });

  it("scheduled_at must be future and within a year", () => {
    const base = { from: "a@x.com", to: "b@x.com", subject: "S", text: "T" };
    const future = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    expect(sendEmailSchema.safeParse({ ...base, scheduled_at: future }).success).toBe(true);
    expect(sendEmailSchema.safeParse({ ...base, scheduled_at: past }).success).toBe(false);
  });

  it("bulkSendSchema caps at 100 with shared defaults", () => {
    const ok = bulkSendSchema.safeParse({
      from: "a@x.com",
      subject: "Hi",
      text: "Hey",
      messages: [{ to: "x@y.com" }, { to: "z@y.com", subject: "Other" }],
    });
    expect(ok.success).toBe(true);
    const tooMany = bulkSendSchema.safeParse({
      from: "a@x.com",
      messages: Array.from({ length: 101 }, () => ({ to: "x@y.com" })),
    });
    expect(tooMany.success).toBe(false);
  });
});
