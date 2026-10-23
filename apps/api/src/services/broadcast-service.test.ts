import { describe, expect, it } from "vitest";

process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";

const { personalize, broadcastUnsubscribeUrl } = await import("./broadcast-service.js");

describe("broadcast personalisation", () => {
  const contact = { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" };

  it("substitutes the supported tokens", () => {
    expect(personalize("Hi {{first_name}} {{last_name}} <{{email}}>", contact)).toBe(
      "Hi Ada Lovelace <ada@example.com>"
    );
  });

  it("greets generically when the first name is missing", () => {
    expect(personalize("Hi {{first_name}}", { ...contact, firstName: null })).toBe("Hi there");
  });

  it("leaves unknown tokens alone rather than printing an empty string", () => {
    expect(personalize("{{first_name}}, your plan is {{plan}}", contact)).toBe(
      "Ada, your plan is {{plan}}"
    );
  });
});

describe("unsubscribe link", () => {
  it("points at the public unsubscribe endpoint with a signed token", () => {
    const url = broadcastUnsubscribeUrl("proj_1", "ada@example.com");
    expect(url).toMatch(/\/v1\/unsubscribe\?token=/);
    expect(url).not.toContain("ada@example.com");
  });
});
