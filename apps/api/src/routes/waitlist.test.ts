import { describe, it, expect } from "vitest";
import { generateReferralCode } from "./waitlist.js";

describe("generateReferralCode", () => {
 it("produces 8-char codes from the unambiguous alphabet", () => {
 for (let i = 0; i < 50; i++) {
 const code = generateReferralCode();
 expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
 }
 });

 it("produces unique codes across a batch", () => {
 const codes = new Set(Array.from({ length: 200 }, () => generateReferralCode()));
 expect(codes.size).toBe(200);
 });
});
