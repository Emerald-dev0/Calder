/**
 * Secret redaction for logs and error reporting.
 *
 * Two layers, because either one alone is bypassable:
 *   1. key-based — anything named like a credential is masked regardless of value;
 *   2. value-based — recognizable secret shapes are masked even under innocuous keys.
 *
 * The value layer is the one that matters for free-form text (error messages,
 * stack traces), where `new URL(redisUrl)` failures happily quote the whole
 * `rediss://user:password@host` string back at you.
 */

export const REDACTED = "[redacted]";

/** Object keys that always hold credentials. */
const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(pass(word|wd)?|secret|token|authorization|cookie|credential|dsn|signature|otp|salt|pepper)$|api[_-]?key|apikey|private[_-]?key|access[_-]?key|secret[_-]?key|keyhash|refreshtoken|clientsecret|webhooksecret|signingsecret|session[_-]?secret|encryption[_-]?key/i;

/** A bare `code` is an API error code, not a secret, unless it looks numeric (OTP). */
function isOtpKey(key: string): boolean {
  if (/^(verification|email|reset|one[_-]?time|auth)[_-]?code$/i.test(key)) return true;
  return false;
}

const VALUE_PATTERNS: RegExp[] = [
  // Calder API keys
  /calder_(test|live)_[A-Za-z0-9_-]{8,}/g,
  // Bearer tokens / API keys in Authorization-style strings
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  // Webhook signing secrets
  /whsec_[A-Za-z0-9_-]{8,}/g,
  // AWS access key ids and secret access keys
  /AKIA[0-9A-Z]{16}/g,
  /aws_secret_access_key=([^&\s]+)/gi,
  // Credentials embedded in connection URLs: scheme://user:pass@host
  // (the username may be empty: redis://:password@host).
  /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]*):([^@\s/]+)@/gi,
  // SNS/SES-ish topic query credentials and generic token query params
  /([?&](?:token|key|secret|password|signature|code)=)[^&\s]+/gi,
  // Long hex/base64 blobs that appear in headers, e.g. v1=<64 hex>
  /(\bv1=)[0-9a-f]{32,}/gi,
  // Recipient/customer addresses in provider and application error text.
  /(^|[\s<(])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || isOtpKey(key);
}

/** Scrub recognized secret shapes out of free-form text. */
export function redactText(input: string, maxLength = 2000): string {
  let out = input;
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, `$1${REDACTED}`);
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}…`;
  return out;
}

/**
 * Deep-copy a value with credentials removed. Bounded depth/width so logging
 * can never turn into an unbounded walk of a cyclic object graph.
 */
export function redactValue(
  value: unknown,
  opts: { depth?: number; maxArray?: number } = {}
): unknown {
  const depth = opts.depth ?? 6;
  const maxArray = opts.maxArray ?? 20;

  function walk(node: unknown, level: number): unknown {
    if (level > depth) return "[truncated]";
    if (node === null || node === undefined) return node;
    if (typeof node === "string") return redactText(node, 500);
    if (typeof node === "number" || typeof node === "boolean" || typeof node === "bigint")
      return node;
    if (typeof node === "function") return "[function]";
    if (node instanceof Date) return node.toISOString();
    if (node instanceof Error) {
      return {
        name: node.name,
        message: redactText(node.message),
        code: (node as { code?: unknown }).code,
      };
    }
    if (Array.isArray(node)) {
      return node.slice(0, maxArray).map((item) => walk(item, level + 1));
    }
    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (isSensitiveKey(key)) {
          out[key] = REDACTED;
          continue;
        }
        out[key] = walk(child, level + 1);
      }
      return out;
    }
    return "[unserializable]";
  }

  return walk(value, 0);
}

/** Host-only Redis/Postgres URL label; never credentials. */
export function redactConnectionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "[invalid-url]";
  }
}
