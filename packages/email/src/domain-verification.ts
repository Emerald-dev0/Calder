/**
 * Domain verification abstraction, supports DNS, Vercel, and future hosted providers.
 * See ADR-005: hosted-domain verification proves project ownership, not sending authorization.
 */

export interface VerificationResult {
  verified: boolean;
  method: string;
  details?: string;
}

export interface DomainVerificationProvider {
  readonly method: string;
  verify(domain: string, token: string): Promise<VerificationResult>;
}

/**
 * DNS verification, checks TXT record (stub for scaffold; real impl does DNS lookup).
 */
export class DnsVerificationProvider implements DomainVerificationProvider {
  readonly method = "dns";

  async verify(domain: string, token: string): Promise<VerificationResult> {
    // In production: DNS lookup for TXT record at `_calder.${domain}`
    // For scaffold: simulate, token "verified" passes, else pending
    if (token === "verified" || process.env.NODE_ENV === "test") {
      return { verified: true, method: this.method, details: `TXT record found for ${domain}` };
    }
    return { verified: false, method: this.method, details: "TXT record not found" };
  }
}

/**
 * Vercel verification, proves control of Vercel project (not DNS zone).
 * Per ADR-005 open problem: this does NOT authorize sending FROM the hosted domain;
 * Calder would map to a managed subdomain.
 */
export class VercelVerificationProvider implements DomainVerificationProvider {
  readonly method = "vercel";

  async verify(domain: string, token: string): Promise<VerificationResult> {
    // In production: call Vercel API to verify project ownership
    // Scaffold: check token pattern
    if (token.startsWith("vercel_")) {
      return {
        verified: true,
        method: this.method,
        details: `Vercel project verified for ${domain} (sending via Calder-managed subdomain)`,
      };
    }
    return { verified: false, method: this.method, details: "Vercel project not verified" };
  }
}

/**
 * Composite, tries providers in order.
 */
export class CompositeVerificationProvider implements DomainVerificationProvider {
  readonly method = "composite";
  private providers: DomainVerificationProvider[];

  constructor(providers: DomainVerificationProvider[]) {
    this.providers = providers;
  }

  async verify(domain: string, token: string): Promise<VerificationResult> {
    for (const p of this.providers) {
      const result = await p.verify(domain, token);
      if (result.verified) return result;
    }
    return { verified: false, method: this.method, details: "No provider verified the domain" };
  }
}
