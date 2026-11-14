import { describe, expect, it } from "vitest";
import { domainOfAddress, parseInboundMime, DEFAULT_PARSE_LIMITS } from "./parse.js";

/**
 * MIME parsing, pinned against real message shapes.
 *
 * These build actual RFC 5322 bytes rather than objects: the unit under test is
 * "what does a customer's mail look like when SES hands it over", and a fixture
 * invented as an object would not exercise boundary markers, transfer encodings
 * or CRLF line endings.
 */

const CRLF = "\r\n";

function mail(lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join(CRLF) + CRLF);
}

const SIMPLE = mail([
  "From: Ada Lovelace <Ada@Example.COM>",
  "To: support@inbox.acme.test",
  "Cc: ops@inbox.acme.test, third@example.test",
  "Reply-To: replies@example.test",
  "Subject: =?utf-8?B?SW52b2ljZSAjNDI=?=",
  "Message-ID: <abc123@example.test>",
  "Date: Tue, 1 Apr 2025 10:00:00 +0000",
  "List-Id: <billing.example.test>",
  "X-Uninteresting: drop me",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi there, your invoice is attached.",
]);

describe("parseInboundMime", () => {
  it("extracts addresses, decoded subject and a plain body", async () => {
    const parsed = await parseInboundMime(SIMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.from).toEqual({ address: "ada@example.com", name: "Ada Lovelace" });
    expect(parsed.to.map((a) => a.address)).toEqual(["support@inbox.acme.test"]);
    expect(parsed.cc.map((a) => a.address)).toEqual(["ops@inbox.acme.test", "third@example.test"]);
    expect(parsed.replyTo.map((a) => a.address)).toEqual(["replies@example.test"]);
    // Encoded-word subject: base64 of "Invoice #42".
    expect(parsed.subject).toBe("Invoice #42");
    expect(parsed.messageId).toBe("<abc123@example.test>");
    expect(parsed.bodyText).toContain("invoice is attached");
    expect(parsed.bodyHtml).toBeNull();
    expect(parsed.bodyTruncated).toBe(false);
  });

  it("keeps the headers worth keeping and drops the rest", async () => {
    const parsed = await parseInboundMime(SIMPLE);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.headers["list-id"]).toBe("<billing.example.test>");
    expect(parsed.headers["message-id"]).toBe("<abc123@example.test>");
    // The raw object keeps everything; the row does not need header noise.
    expect(parsed.headers["x-uninteresting"]).toBeUndefined();
  });

  it("parses multipart bodies and stores attachments with a checksum", async () => {
    const boundary = "----=_Part_1_2_3";
    const pdf = "JVBERi0xLjQKJSVFT0YK"; // "%PDF-1.4\n%%EOF\n" in base64
    const raw = mail([
      "From: billing@acme.test",
      "To: support@inbox.acme.test",
      "Subject: March invoice",
      "Message-ID: <mp1@acme.test>",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: multipart/alternative; boundary=\"alt\"",
      "",
      "--alt",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please find your invoice attached.",
      "--alt",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Please find your <strong>invoice</strong> attached.</p>",
      "--alt--",
      "",
      `--${boundary}`,
      "Content-Type: application/pdf; name=\"invoice-042.pdf\"",
      "Content-Disposition: attachment; filename=\"invoice-042.pdf\"",
      "Content-Transfer-Encoding: base64",
      "",
      pdf,
      `--${boundary}--`,
    ]);

    const parsed = await parseInboundMime(raw);
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.bodyText).toContain("Please find your invoice");
    expect(parsed.bodyHtml).toContain("<strong>invoice</strong>");
    expect(parsed.attachments).toHaveLength(1);
    const [att] = parsed.attachments;
    expect(att?.filename).toBe("invoice-042.pdf");
    expect(att?.contentType).toBe("application/pdf");
    expect(att?.skippedReason).toBeNull();
    expect(att?.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(att?.content?.byteLength).toBe(15);
  });

  it("truncates long bodies and says so", async () => {
    const long = "x".repeat(5_000);
    const raw = mail([
      "From: a@acme.test",
      "To: inbox@inbox.acme.test",
      "Subject: long",
      "Content-Type: text/plain",
      "",
      long,
    ]);
    const parsed = await parseInboundMime(raw, { ...DEFAULT_PARSE_LIMITS, maxBodyChars: 1_000 });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.bodyTruncated).toBe(true);
    expect(parsed.bodyText).toHaveLength(1_000);
  });

  it("records an oversized attachment instead of storing or hiding it", async () => {
    const boundary = "b1";
    const raw = mail([
      "From: a@acme.test",
      "To: inbox@inbox.acme.test",
      "Subject: big",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "see attachment",
      `--${boundary}`,
      "Content-Type: application/octet-stream; name=\"big.bin\"",
      "Content-Disposition: attachment; filename=\"big.bin\"",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("y".repeat(4_000)).toString("base64"),
      `--${boundary}--`,
    ]);

    const parsed = await parseInboundMime(raw, {
      ...DEFAULT_PARSE_LIMITS,
      maxAttachmentBytes: 1_000,
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.skippedReason).toBe("too_large");
    expect(parsed.attachments[0]?.content).toBeNull();
    expect(parsed.attachments[0]?.sizeBytes).toBeGreaterThan(1_000);
  });

  it("returns a failure rather than throwing on junk", async () => {
    const empty = await parseInboundMime(new Uint8Array(0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toContain("empty");

    // Binary noise: no headers, no structure. Whatever postal-mime decides,
    // this function must answer, not explode.
    const junk = new Uint8Array([0x00, 0xff, 0x12, 0x7f, 0x00]);
    const result = await parseInboundMime(junk);
    expect(typeof result.ok).toBe("boolean");
  });

  it("handles a message with no Subject or From without inventing them", async () => {
    const raw = mail([
      "To: inbox@inbox.acme.test",
      "Content-Type: text/plain",
      "",
      "anonymous",
    ]);
    const parsed = await parseInboundMime(raw);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.subject).toBeNull();
    expect(parsed.from).toBeNull();
    expect(parsed.messageId).toBeNull();
  });
});

describe("domainOfAddress", () => {
  it("takes the domain after the last @, lower-cased", () => {
    expect(domainOfAddress("Support@Inbox.ACME.test")).toBe("inbox.acme.test");
    expect(domainOfAddress("weird@local@inbox.acme.test")).toBe("inbox.acme.test");
    expect(domainOfAddress("no-at-sign")).toBeNull();
    expect(domainOfAddress("trailing@")).toBeNull();
    expect(domainOfAddress(null)).toBeNull();
  });
});
