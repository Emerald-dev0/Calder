import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey, isValidKeyFormat } from "./api-keys";

describe("api keys", () => {
 it("generates prefixed keys and verifies hash", () => {
 const key = generateApiKey("test");
 expect(key.secret.startsWith("calder_sk_test_")).toBe(true);
 expect(key.hash).not.toContain(key.secret.slice(-8));
 expect(verifyApiKey(key.secret, key.hash)).toBe(true);
 expect(verifyApiKey(key.secret + "x", key.hash)).toBe(false);
 });

 it("validates key format", () => {
 const key = generateApiKey("live");
 expect(isValidKeyFormat(key.secret)).toBe(true);
 expect(isValidKeyFormat("bogus")).toBe(false);
 });

 it("hashes deterministically", () => {
 expect(hashApiKey("abc")).toBe(hashApiKey("abc"));
 });
});
