/**
 * Redaction for anything that leaves the database and lands in a browser.
 *
 * The Raw JSON and Headers tabs on the message detail show whatever the send
 * path recorded. A message's metadata can carry customer-supplied headers, and
 * an error string can carry a provider response — either may quote a bearer
 * token, an API key or a webhook signing secret. Nothing here is trusted to be
 * clean, so everything is walked before render.
 *
 * Two layers, because one is not enough:
 *   - key-based: a field named `authorization` / `api_key` / `password` is
 *     replaced wholesale regardless of its value;
 *   - value-based: any string that *looks* like a credential is replaced even
 *     when it sits in a innocently-named field (e.g. `last_error`).
 *
 * The masked form keeps a short, non-secret prefix so an operator can tell
 * `calder_sk_test_` from `calder_sk_live_` without being able to use the key.
 */

const SENSITIVE_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|key|secret|client[-_]?secret|signing[-_]?secret|webhook[-_]?secret|password|passwd|pwd|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|bearer|auth)$/i;

/** Keys that are sensitive only when they appear as a suffix, e.g. `x_calder_secret`. */
const SENSITIVE_SUFFIX = /([-_](?:secret|token|password|key))$/i;

/**
 * Credential shapes seen in this codebase and in provider responses.
 * Order matters: the most specific pattern runs first so a mask does not
 * swallow only part of a value.
 */
const CREDENTIAL_PATTERNS: Array<{ re: RegExp; keep: number }> = [
  // calder_sk_test_abc123 / calder_pk_live_abc123
  { re: /\bcalder_(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]{6,}/g, keep: 20 },
  // whsec_ + hex (webhook signing secret)
  { re: /\bwhsec_[A-Za-z0-9]{8,}/g, keep: 8 },
  // Stripe-style and generic sk_/pk_ keys
  { re: /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{8,}/g, keep: 6 },
  // JWT
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, keep: 6 },
  // Authorization: Bearer <token>
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, keep: 7 },
  // AWS access key id
  { re: /\bAKIA[0-9A-Z]{12,}\b/g, keep: 4 },
];

export const MASK = "…redacted";

function maskValue(value: string, keep = 0): string {
  if (value === "") return value;
  const visible = Math.min(Math.max(keep, 0), Math.max(value.length - 1, 0), 24);
  return `${value.slice(0, visible)}${MASK}`;
}

/** Mask every credential-shaped substring inside free text. */
export function redactText(input: string): string {
  let out = input;
  for (const { re, keep } of CREDENTIAL_PATTERNS) {
    out = out.replace(re, (match) => maskValue(match, keep));
  }
  return out;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_SUFFIX.test(key);
}

/**
 * Deep-redact a JSON-ish value.
 *
 * Arrays of scalars are kept (a header list is readable), but the element at a
 * sensitive position is masked through its parent key. Depth is capped so a
 * pathological payload cannot hang the render.
 */
export function redactValue(value: unknown, key = "", depth = 0): unknown {
  if (depth > 12) return "[truncated]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (key && isSensitiveKey(key)) return maskValue(value, 0);
    return redactText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    if (key && isSensitiveKey(key)) return MASK;
    return value;
  }
  if (Array.isArray(value)) {
    if (key && isSensitiveKey(key)) return MASK;
    return value.map((v) => redactValue(v, key, depth + 1));
  }
  if (typeof value === "object") {
    if (key && isSensitiveKey(key)) return MASK;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Parse a header blob (object or newline-delimited string) and redact it. */
export function redactHeaders(headers: unknown): Array<{ name: string; value: string }> {
  if (!headers) return [];
  const pairs: Array<[string, string]> = [];

  if (typeof headers === "string") {
    for (const line of headers.split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i <= 0) continue;
      pairs.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  } else if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2)
        pairs.push([String(entry[0]), String(entry[1])]);
      else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        if (typeof o.name === "string") pairs.push([o.name, String(o.value ?? "")]);
      }
    }
  } else if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      pairs.push([k, typeof v === "string" ? v : JSON.stringify(v)]);
    }
  }

  return pairs.map(([name, value]) => ({
    name,
    value: isSensitiveKey(name) ? maskValue(value, 0) : redactText(value),
  }));
}

/** Pretty-print a redacted JSON document, or return a placeholder on bad input. */
export function redactedJson(value: unknown): string {
  try {
    return JSON.stringify(redactValue(value), null, 2);
  } catch {
    return '"unserialisable payload"';
  }
}
