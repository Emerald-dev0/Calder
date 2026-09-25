import { describe, expect, it } from "vitest";
import { Calder, CalderApiError } from "./index.js";

describe("Calder SDK", () => {
  it("sends auth and idempotency headers and unwraps data", async () => {
    const client = new Calder("ck_test", {
      baseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        expect(input).toBe("https://api.example.test/v1/emails");
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer ck_test");
        expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("welcome-1");
        return new Response(JSON.stringify({ data: { id: "em_1", status: "queued" } }), { status: 202 });
      },
    });
    await expect(client.emails.send({ from: "a@example.com", to: "b@example.com", subject: "Hi", text: "Hello" }, { idempotencyKey: "welcome-1" })).resolves.toEqual({ id: "em_1", status: "queued" });
  });

  it("exposes structured API errors", async () => {
    const client = new Calder("ck_test", { fetch: async () => new Response(JSON.stringify({ error: { code: "bad_request", message: "Nope" } }), { status: 400 }) });
    await expect(client.emails.get("em_1")).rejects.toBeInstanceOf(CalderApiError);
  });
});
