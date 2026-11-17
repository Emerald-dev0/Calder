import { createHash } from "node:crypto";
import PostalMime from "postal-mime";

/**
 * MIME parsing for inbound mail.
 *
 * `postal-mime` does the hard part (multipart, base64/quoted-printable,
 * encoded-words in headers, nested message/rfc822). What this module adds is
 * everything a *product* needs and a parser does not do:
 *
 *  - caps: bodies are truncated to a configured character budget and marked as
 *    truncated, so one 25 MB HTML mail cannot exhaust a row or a render;
 *  - attachment budgeting: parts over the per-message cap are reported as
 *    skipped with their size rather than silently dropped, because "your
 *    attachment was not stored" is something the recipient must be able to see;
 *  - a stable shape: addresses normalised, headers lower-cased and joined, and
 *    a checksum per attachment so the same file can be recognised later.
 *
 * It never throws on malformed input. Undeliverable junk should be recorded
 * with a reason, not crash the SNS handler and cause an infinite retry.
 */

export interface ParsedAddress {
  address: string;
  name: string | null;
}

export interface ParsedAttachment {
  partIndex: number;
  filename: string | null;
  contentType: string | null;
  disposition: string | null;
  contentId: string | null;
  sizeBytes: number;
  content: Uint8Array | null;
  checksumSha256: string;
  /** Set when the part was deliberately not stored. */
  skippedReason: "too_large" | "attachment_budget_exceeded" | null;
}

export interface ParsedInbound {
  ok: true;
  subject: string | null;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  replyTo: ParsedAddress[];
  messageId: string | null;
  headers: Record<string, string>;
  bodyText: string | null;
  bodyHtml: string | null;
  bodyTruncated: boolean;
  attachments: ParsedAttachment[];
}

export interface ParseFailure {
  ok: false;
  reason: string;
}

export interface ParseLimits {
  /** Characters kept per body. */
  maxBodyChars: number;
  /** Bytes kept per attachment; larger parts are recorded but not stored. */
  maxAttachmentBytes: number;
  /** Total attachment bytes kept per message. */
  maxTotalAttachmentBytes: number;
  /** Parts kept per message. */
  maxAttachments: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxBodyChars: 262_144,
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxTotalAttachmentBytes: 20 * 1024 * 1024,
  maxAttachments: 50,
};

/** Headers worth keeping in the row. The rest lives in the raw object. */
const KEPT_HEADERS = new Set([
  "date",
  "message-id",
  "in-reply-to",
  "references",
  "subject",
  "from",
  "to",
  "cc",
  "reply-to",
  "return-path",
  "list-id",
  "list-unsubscribe",
  "auto-submitted",
  "precedence",
  "x-mailer",
  "user-agent",
  "authentication-results",
  "received-spf",
  "content-type",
]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanAddress(
  entry: { address?: string; name?: string } | undefined
): ParsedAddress | null {
  const address = (entry?.address ?? "").trim();
  if (!address) return null;
  const name = (entry?.name ?? "").trim();
  return { address: address.toLowerCase(), name: name.length > 0 ? name : null };
}

function truncate(
  value: string | undefined | null,
  max: number
): { text: string | null; cut: boolean } {
  if (typeof value !== "string" || value.length === 0) return { text: null, cut: false };
  if (value.length <= max) return { text: value, cut: false };
  return { text: value.slice(0, max), cut: true };
}

export async function parseInboundMime(
  raw: Uint8Array,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS
): Promise<ParsedInbound | ParseFailure> {
  if (raw.byteLength === 0) return { ok: false, reason: "message is empty" };

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    // A fresh ArrayBuffer copy: `raw.buffer` can be a SharedArrayBuffer (and
    // can be larger than the view), and PostalMime wants a plain one.
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    parsed = await PostalMime.parse(copy.buffer);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "could not parse MIME" };
  }

  const text = truncate(parsed.text, limits.maxBodyChars);
  const html = truncate(parsed.html, limits.maxBodyChars);

  const headers: Record<string, string> = {};
  for (const header of parsed.headers ?? []) {
    const key = String(header.key ?? "").toLowerCase();
    if (!KEPT_HEADERS.has(key)) continue;
    const value = String(header.value ?? "").trim();
    if (value.length === 0) continue;
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }

  const attachments: ParsedAttachment[] = [];
  let totalBytes = 0;
  const parts = parsed.attachments ?? [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i >= limits.maxAttachments) break;
    const content = part.content as ArrayBuffer | Uint8Array | string | undefined;
    const bytes =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : content instanceof Uint8Array
          ? content
          : content
            ? new Uint8Array(content)
            : new Uint8Array(0);

    const sizeBytes = bytes.byteLength;
    let skippedReason: ParsedAttachment["skippedReason"] = null;
    if (sizeBytes > limits.maxAttachmentBytes) skippedReason = "too_large";
    else if (totalBytes + sizeBytes > limits.maxTotalAttachmentBytes)
      skippedReason = "attachment_budget_exceeded";

    if (!skippedReason) totalBytes += sizeBytes;

    attachments.push({
      partIndex: i,
      filename: (part.filename ?? "").trim() || null,
      contentType: part.mimeType || null,
      disposition: part.disposition ?? null,
      contentId: part.contentId ?? null,
      sizeBytes,
      content: skippedReason ? null : bytes,
      // A skipped part is still identifiable: hash what we declined to keep so
      // two deliveries of the same mail can be compared.
      checksumSha256: sha256(bytes),
      skippedReason,
    });
  }

  return {
    ok: true,
    subject: (parsed.subject ?? "").trim() || null,
    from: cleanAddress(parsed.from),
    to: (parsed.to ?? []).map(cleanAddress).filter((a): a is ParsedAddress => a !== null),
    cc: (parsed.cc ?? []).map(cleanAddress).filter((a): a is ParsedAddress => a !== null),
    replyTo: (parsed.replyTo ?? []).map(cleanAddress).filter((a): a is ParsedAddress => a !== null),
    messageId: (parsed.messageId ?? "").trim() || null,
    headers,
    bodyText: text.text,
    bodyHtml: html.text,
    bodyTruncated: text.cut || html.cut,
    attachments,
  };
}

/** Lower-cased domain part of an address, or null. */
export function domainOfAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return null;
  return address
    .slice(at + 1)
    .trim()
    .toLowerCase();
}
