import type { VerifyOutcome } from "@calder/db";

export interface DnsCheckResult {
  verified: boolean;
  detail: string;
  /** True when the hourly attempt budget is exhausted; callers should stop polling. */
  rateLimited?: boolean;
}

/**
 * Map a domain-verification state-machine outcome to a UI-safe result.
 *
 * Expected states (pending, failed, throttled, foreign-owned) are returned, never
 * thrown: throwing turns a routine "not yet" into a 500, and the onboarding
 * auto-poll would spam it while also burning the hourly attempt budget.
 * Only genuinely exceptional states (unknown domain, unknown outcome) throw.
 */
export function mapVerifyOutcome(outcome: VerifyOutcome): DnsCheckResult {
  switch (outcome.kind) {
    case "verified":
      return { verified: true, detail: "TXT record matched. Domain verified." };
    case "not_found":
      throw new Error("Domain not found.");
    case "expired":
      return {
        verified: false,
        detail: "Challenge expired (72h). Mint a fresh token below.",
      };
    case "rate_limited":
      return {
        verified: false,
        rateLimited: true,
        detail: `Too many attempts — try again in ${Math.ceil(outcome.retryAfterSec / 60)}m.`,
      };
    case "cross_tenant":
      return {
        verified: false,
        detail:
          "This domain is already verified on another project. Each domain can only be verified once.",
      };
    case "dns_error":
      return { verified: false, detail: `DNS lookup failed: ${outcome.message}` };
    case "mismatch":
      return {
        verified: false,
        detail:
          outcome.found.length === 0
            ? `No TXT records yet at ${outcome.expected.host} — propagation can take minutes to hours.`
            : `Found TXT records at ${outcome.expected.host} but none match the challenge exactly.`,
      };
    default:
      throw new Error("Unexpected verification outcome");
  }
}
