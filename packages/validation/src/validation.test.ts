import { describe, it, expect } from "vitest";
import { sendEmailSchema, createDomainSchema } from "./index";

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
});
