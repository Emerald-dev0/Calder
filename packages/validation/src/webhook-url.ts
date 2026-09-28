/**
 * SSRF guard for customer-registered webhook endpoints (Phase 3 / M3.1).
 * Same rule at registry-write (API + dashboard) and delivery-time (worker
 * re-checks its own copy — never trust a stored value).
 */

const UNSAFE_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default",
]);

export function isPublicWebhookUrl(url: string, opts?: { allowLoopback?: boolean }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false; // no smuggled basic-auth
  if (parsed.protocol !== "https:") {
    // http only ever for explicit local testing, never in production traffic.
    if (!(opts?.allowLoopback && parsed.protocol === "http:" && isLoopback(parsed.hostname))) {
      return false;
    }
  }
  const host = parsed.hostname.toLowerCase();
  // The localhost escape hatch only ever opens for dev tooling with the
  // explicit flag; it never opens for "localhost"-trick hostnames.
  if (UNSAFE_HOSTNAMES.has(host) && !(opts?.allowLoopback && isLoopback(host))) return false;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return opts?.allowLoopback === true;
  if (bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd")) return false;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(bare);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || isLoopback(bare)) return opts?.allowLoopback === true;
    if (a === 0 || a === 10) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast/reserved/broadcast
  }
  return true;
}

function isLoopback(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "localhost" || bare.startsWith("127.") || bare === "::1";
}
