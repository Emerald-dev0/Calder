import { describe, it, expect } from "vitest";
import { sanitizeHeaders } from "./email-service.js";

describe("sanitizeHeaders", () => {
 it("passes List-Unsubscribe headers through", () => {
 expect(
 sanitizeHeaders({
 "List-Unsubscribe": "<https://x.test/u>",
 "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
 })
 ).toEqual({
 "List-Unsubscribe": "<https://x.test/u>",
 "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
 });
 });

 it("passes X- prefixed custom headers", () => {
 expect(sanitizeHeaders({ "X-Calder-Tag": "welcome" })).toEqual({
 "X-Calder-Tag": "welcome",
 });
 });

 it("drops envelope and dangerous headers", () => {
 expect(
 sanitizeHeaders({
 From: "evil@x.test",
 To: "victim@x.test",
 Subject: "hijacked",
 "Content-Type": "text/html",
 Received: "by evil",
 Bcc: "spam@x.test",
 "X-Ok": "yes",
 })
 ).toEqual({ "X-Ok": "yes" });
 });

 it("drops empty and oversized values", () => {
 expect(sanitizeHeaders({ "X-A": "", "X-B": "x".repeat(2001) })).toEqual({});
 });

 it("returns empty for undefined", () => {
 expect(sanitizeHeaders(undefined)).toEqual({});
 });
});
