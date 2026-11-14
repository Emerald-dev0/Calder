import { resolveMx, resolveTxt } from "node:dns/promises";
import { randomBytes } from "node:crypto";

/**
 * Domain ownership verification (M4.1).
 *
 * Challenge: the tenant proves control of `example.com` by publishing
 *   _calder.example.com.  TXT  "calder-verification=<token>"
 * The ORACLE is injectable so the whole state machine is unit-testable with
 * no live DNS; production uses node:dns (system resolver) with a timeout,
 * then falls back to the DoH oracle (dns.google) which frequently sees
 * freshly-published records before recursive caches ship them downstream.
 */

export const TXT_HOST_PREFIX = "_calder";
export const TXT_VALUE_PREFIX = "calder-verification=";
/** Challenge TTL: after this the token is dead and must be regenerated. */
export const CHALLENGE_TTL_MS = 72 * 60 * 60 * 1000;
/** Verify attempts allowed per rolling hour per domain. */
export const VERIFY_RATE_LIMIT = 10;
export const VERIFY_WINDOW_MS = 60 * 60 * 1000;

export type TxtOracle = (host: string) => Promise<string[]>;

/** 192-bit token — guessing is out; see ADR-039. */
export function newVerificationToken(): string {
  return `cvt_${randomBytes(24).toString("hex")}`;
}

export function expectedTxtValue(token: string): string {
  return `${TXT_VALUE_PREFIX}${token}`;
}

export function expectedTxtHost(domain: string): string {
  return `${TXT_HOST_PREFIX}.${domain}`;
}

const DNS_TIMEOUT_MS = 5_000;

async function systemTxt(host: string): Promise<string[]> {
  const rows = (await resolveTxt(host)).map((chunks) => chunks.join(""));
  return rows;
}

/** DoH fallback via dns.google — 2s budget, JSON answer section. */
async function dohTxt(host: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4_000);
  try {
    // TXT = type 16.
    const url = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=16`;
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`DoH ${res.status}`);
    const body = (await res.json()) as {
      Answer?: { data?: string }[];
      Status?: number;
    };
    return (body.Answer ?? [])
      .map((a) => (a.data ?? "").replace(/^"|"$/g, ""))
      .filter((s) => s.length > 0);
  } finally {
    clearTimeout(t);
  }
}

/** Production oracle: system resolver (5s), DoH fallback on failure/timeout. */
export function defaultTxtOracle(fetchImpl: typeof fetch = fetch): TxtOracle {
  return async (host) => {
    try {
      const rows = await Promise.race([
        systemTxt(host),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DNS timeout")), DNS_TIMEOUT_MS)
        ),
      ]);
      return rows;
    } catch {
      // NXDOMAIN / timeout / servfail — try the public oracle before blaming
      // the tenant; propagation to recursive caches lags public authoritative.
      try {
        return await dohTxt(host, fetchImpl);
      } catch (e) {
        const err = e as Error & { name?: string };
        if (err.name === "AbortError") throw new Error("DNS lookup timed out");
        throw new Error("DNS lookup failed (propagation pending or resolver unreachable)");
      }
    }
  };
}

export type VerifyVerdict =
  | { kind: "verified" }
  | { kind: "mismatch"; expected: string; found: string[] }
  | { kind: "dns_error"; message: string };

/** Pure: compare challenge against oracle rows. */
export async function checkOwnership(
  oracle: TxtOracle,
  host: string,
  expectedValue: string
): Promise<VerifyVerdict> {
  let found: string[];
  try {
    found = await oracle(host);
  } catch (e) {
    return { kind: "dns_error", message: e instanceof Error ? e.message : "DNS lookup failed" };
  }
  if (found.some((v) => v.trim() === expectedValue)) return { kind: "verified" };
  return {
    kind: "mismatch",
    expected: expectedValue,
    // Never echo unlimited DNS data into API responses/logs.
    found: found.slice(0, 5),
  };
}

/* ── Receiving domains (Stage 3) ──────────────────────────────────────────── */

/**
 * Receiving uses a *different* challenge name from sending on purpose: a
 * customer may want `acme.com` to send with us and `inbox.acme.com` to receive
 * with us, and two different TXT records on one name cannot coexist.
 */
export const INBOUND_TXT_HOST_PREFIX = "_calder-inbound";
export const INBOUND_TXT_VALUE_PREFIX = "calder-inbound=";

export function expectedInboundTxtHost(domain: string): string {
  return `${INBOUND_TXT_HOST_PREFIX}.${domain}`;
}

export function expectedInboundTxtValue(token: string): string {
  return `${INBOUND_TXT_VALUE_PREFIX}${token}`;
}

export interface MxRecord {
  exchange: string;
  priority: number;
}

export type MxOracle = (domain: string) => Promise<MxRecord[]>;

/**
 * MX via the system resolver, falling back to DoH (type 15).
 *
 * `[]` and "no such host" both mean "no MX", which is a *safe* answer here: a
 * domain with no MX cannot currently receive mail from anyone, so pointing it
 * at us disrupts nothing.
 */
export function defaultMxOracle(fetchImpl: typeof fetch = fetch): MxOracle {
  return async (domain) => {
    try {
      const rows = await Promise.race([
        resolveMx(domain),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DNS timeout")), DNS_TIMEOUT_MS)
        ),
      ]);
      return rows
        .map((r) => ({
          exchange: r.exchange.replace(/\.$/, "").toLowerCase(),
          priority: r.priority,
        }))
        .sort((a, b) => a.priority - b.priority);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOTFOUND" || code === "ENODATA") return [];
      try {
        return await dohMx(domain, fetchImpl);
      } catch (inner) {
        const err = inner as Error & { name?: string };
        if (err.name === "AbortError") throw new Error("MX lookup timed out");
        throw new Error("MX lookup failed (resolver unreachable)");
      }
    }
  };
}

async function dohMx(domain: string, fetchImpl: typeof fetch): Promise<MxRecord[]> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4_000);
  try {
    // MX = type 15. `data` looks like "10 inbound-smtp.us-east-1.amazonaws.com."
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=15`;
    const res = await fetchImpl(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`DoH ${res.status}`);
    const body = (await res.json()) as { Answer?: { data?: string; type?: number }[] };
    return (body.Answer ?? [])
      .filter((a) => a.type === 15)
      .map((a) => {
        const [priority, exchange] = (a.data ?? "").trim().split(/\s+/);
        return {
          exchange: (exchange ?? "").replace(/\.$/, "").toLowerCase(),
          priority: Number(priority ?? 0),
        };
      })
      .filter((r) => r.exchange.length > 0)
      .sort((a, b) => a.priority - b.priority);
  } finally {
    clearTimeout(t);
  }
}

export type MxVerdict =
  | { kind: "points_to_us"; records: MxRecord[] }
  /** Someone else receives this domain today (Google Workspace, M365, …). */
  | { kind: "foreign"; records: MxRecord[]; others: MxRecord[] }
  | { kind: "no_mx" }
  | { kind: "dns_error"; message: string };

/**
 * Pure: does this domain's MX point only at us?
 *
 * Deliberately strict. A domain whose MX still includes Google or Microsoft
 * must NOT be switched on: adding ours alongside theirs would split delivery
 * between two providers and silently lose mail in one of them. The customer
 * chooses a dedicated receiving subdomain instead, which is the whole point of
 * the subdomain-first onboarding in the audit.
 */
export async function checkMx(mx: MxOracle, domain: string, ourHost: string): Promise<MxVerdict> {
  let records: MxRecord[];
  try {
    records = await mx(domain);
  } catch (e) {
    return { kind: "dns_error", message: e instanceof Error ? e.message : "MX lookup failed" };
  }
  const ourHostLower = ourHost.toLowerCase();
  const ours = records.filter((r) => r.exchange === ourHostLower);
  const others = records.filter((r) => r.exchange !== ourHostLower);
  if (ours.length > 0) {
    if (others.length > 0) return { kind: "foreign", records, others };
    return { kind: "points_to_us", records };
  }
  if (records.length === 0) return { kind: "no_mx" };
  return { kind: "foreign", records, others };
}
