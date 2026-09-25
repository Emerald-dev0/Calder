import { resolveTxt } from "node:dns/promises";

/** Domain verification is proof of control, never a demo toggle. */
export interface VerificationResult {
  verified: boolean;
  method: string;
  details?: string;
}

export interface DomainVerificationProvider {
  readonly method: string;
  verify(domain: string, token: string): Promise<VerificationResult>;
}

export type TxtResolver = (hostname: string) => Promise<string[][]>;

export class DnsVerificationProvider implements DomainVerificationProvider {
  readonly method = "dns";
  private readonly resolver: TxtResolver;

  constructor(resolver: TxtResolver = resolveTxt) {
    this.resolver = resolver;
  }

  async verify(domain: string, token: string): Promise<VerificationResult> {
    const hostname = `_calder.${domain.trim().toLowerCase().replace(/\.$/, "")}`;
    if (!token || token.length < 16) return { verified: false, method: this.method, details: "Invalid verification challenge" };
    try {
      const records = await this.resolver(hostname);
      const values = records.map((parts) => parts.join(""));
      const verified = values.includes(token) || values.includes(`calder_verify_${token}`);
      return {
        verified,
        method: this.method,
        details: verified ? `TXT record found for ${hostname}` : `Expected challenge was not found at ${hostname}`,
      };
    } catch (error) {
      return {
        verified: false,
        method: this.method,
        details: `DNS lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }
}

/** Hosted verification proves control of the hosting project, not arbitrary FROM authorization. */
export class VercelVerificationProvider implements DomainVerificationProvider {
  readonly method = "vercel";
  async verify(domain: string, token: string): Promise<VerificationResult> {
    if (token.startsWith("vercel_")) return { verified: true, method: this.method, details: `Vercel project verified for ${domain}` };
    return { verified: false, method: this.method, details: "Vercel project not verified" };
  }
}

export class CompositeVerificationProvider implements DomainVerificationProvider {
  readonly method = "composite";
  constructor(private readonly providers: DomainVerificationProvider[]) {}
  async verify(domain: string, token: string): Promise<VerificationResult> {
    for (const provider of this.providers) {
      const result = await provider.verify(domain, token);
      if (result.verified) return result;
    }
    return { verified: false, method: this.method, details: "No provider verified the domain" };
  }
}
