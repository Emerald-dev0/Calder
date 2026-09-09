import { describe, it, expect } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

describe("unsubscribe tokens", () => {
 it("round-trips a valid token", () => {
 const token = signUnsubscribeToken("proj_website", "Ada@Example.com");
 expect(verifyUnsubscribeToken(token)).toEqual({
 projectId: "proj_website",
 email: "ada@example.com",
 });
 });

 it("rejects tampered payloads and signatures", () => {
 const token = signUnsubscribeToken("proj_website", "a@b.co");
 const [payload] = token.split(".");
 expect(
 verifyUnsubscribeToken(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
 ).toBeNull();
 expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
 expect(verifyUnsubscribeToken("")).toBeNull();
 });

 it("binds token to project (no cross-project reuse)", () => {
 const token = signUnsubscribeToken("proj_a", "a@b.co");
 expect(verifyUnsubscribeToken(token)?.projectId).toBe("proj_a");
 });
});
