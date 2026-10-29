import { describe, expect, it } from "vitest";
import { createEmailService } from "./service.js";
import type { EmailMessage, EmailProvider } from "./provider.js";

describe("outbound Calder footer", () => {
  it("brands the provider-bound message without mutating the original", async () => {
    let sent: EmailMessage | undefined;
    const provider: EmailProvider = {
      name: "test",
      async send(message) {
        sent = message;
        return { providerMessageId: "1", provider: "test", accepted: true };
      },
    };
    const message = {
      from: "a@example.com",
      to: "b@example.com",
      subject: "Hello",
      html: "<html><body><p>Hello</p></body></html>",
      text: "Hello",
    };
    await createEmailService(provider).send(message);
    expect(sent?.html).toContain("<p>Hello</p><div");
    expect(sent?.html).toContain('href="https://calder.click/abuse"');
    expect(sent?.html).toContain("</div></body>");
    expect(sent?.text).toBe(
      "Hello\n\n\n--\nSent with Calder · https://calder.click\nReport abuse: https://calder.click/abuse"
    );
    expect(message.html).toBe("<html><body><p>Hello</p></body></html>");
  });
  it("preserves absent alternatives and permits an authorized removal", async () => {
    let sent: EmailMessage | undefined;
    const provider: EmailProvider = {
      name: "test",
      async send(message) {
        sent = message;
        return { providerMessageId: "1", provider: "test", accepted: true };
      },
    };
    const message = { from: "a@example.com", to: "b@example.com", subject: "Hello", text: "Hello" };
    await createEmailService(provider).send(message);
    expect(sent?.text).toContain("Report abuse: https://calder.click/abuse");
    expect(sent?.html).toBeUndefined();
    await createEmailService(provider).send(message, { removeCalderBranding: true });
    expect(sent?.text).toBe("Hello");
  });
});
