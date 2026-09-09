import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface GeneratedApiKey {
  /** Full secret, show ONCE at creation, never stored raw */
  secret: string;
  /** Hash to store in DB */
  hash: string;
  /** Prefix fragment for identification (e.g., calder_sk_test_abc123) */
  prefix: string;
  /** First 12 chars of prefix for display */
  displayPrefix: string;
}

const PREFIX_MAP = {
  test: "calder_sk_test_",
  live: "calder_sk_live_",
} as const;

type KeyEnv = keyof typeof PREFIX_MAP;

/**
 * Generate a cryptographically secure API key.
 * Format: calder_sk_{env}_{32 random hex chars}
 */
export function generateApiKey(env: KeyEnv = "test"): GeneratedApiKey {
  const random = randomBytes(24).toString("hex"); // 48 hex chars
  const secret = `${PREFIX_MAP[env]}${random}`;
  const hash = hashApiKey(secret);
  const prefix = secret.slice(0, 20); // prefix for lookup/display
  const displayPrefix = `${prefix}...`;
  return { secret, hash, prefix, displayPrefix };
}

/**
 * Hash via SHA-256 hex. In production consider using a pepper + slow hash,
 * but SHA-256 with timingSafeEqual is appropriate for high-throughput API key verification
 * (bcrypt would be too slow per-request). Pepper can be added via env.
 */
export function hashApiKey(secret: string): string {
  const pepper = process.env.API_KEY_PEPPER ?? "";
  return createHash("sha256").update(`${pepper}${secret}`).digest("hex");
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
export function verifyApiKey(secret: string, hash: string): boolean {
  const computed = hashApiKey(secret);
  if (computed.length !== hash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
  } catch {
    // fallback for non-hex hashes
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  }
}

export function extractKeyPrefix(secret: string): string {
  // Extract up to first 20 chars for DB lookup optimization
  return secret.slice(0, 32);
}

/**
 * Validate key format (basic). Real validation is hash lookup.
 * Legacy `avenor_sk_` keys verify forever, hashing is prefix-agnostic.
 */
export function isValidKeyFormat(key: string): boolean {
  return /^(calder|avenor)_sk_(test|live)_[a-f0-9]{32,}$/.test(key);
}
