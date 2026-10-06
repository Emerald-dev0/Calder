import { isIP } from "node:net";

/**
 * Return true only for globally routable IP literals. This is deliberately
 * stricter than "not RFC1918": metadata, benchmark, documentation, shared,
 * multicast, link-local, mapped, and other special-use ranges must not become
 * customer-controlled server-side request targets.
 */
export function isPublicIpAddress(address: string): boolean {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;

  const bytes = parseIpv6(normalized);
  if (!bytes) return false;

  // IPv4-mapped IPv6 addresses inherit the IPv4 policy. This catches both
  // ::ffff:127.0.0.1 and the hexadecimal spelling ::ffff:7f00:1.
  if (
    bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  // Unspecified, loopback, unique-local, link-local, site-local, multicast,
  // documentation, benchmarking, and other special-use IPv6 prefixes.
  if (bytes.every((value) => value === 0)) return false; // ::
  if (bytes.slice(0, 15).every((value) => value === 0)) return false; // ::1
  if (bytes[0] === 0xfc || bytes[0] === 0xfd) return false; // fc00::/7
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return false; // fe80::/10
  if (bytes[0] === 0xff) return false; // ff00::/8
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return false; // fec0::/10
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return false; // 2001:db8::/32 documentation
  }
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    ((bytes[2] === 0x00 && bytes[3] === 0x00) ||
      (bytes[2] === 0x00 && bytes[3] === 0x02) ||
      (bytes[2] === 0x00 && bytes[3] === 0x10))
  ) {
    return false; // 2001:0000, 2001:0002, 2001:0010 special-use ranges
  }
  return true;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 192 && b === 168) return false;
  if (a === 198 && b === 18) return false; // benchmarking (198.18/15)
  if (a === 198 && b === 19) return false;
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function parseIpv6(input: string): Uint8Array | null {
  if (input.includes("%")) return null; // IPv6 zones are not valid public URL targets.
  const value = input;
  if (!value) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups: number[] = [];
  const append = (part: string): boolean => {
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (
        octets.length !== 4 ||
        octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
      )
        return false;
      groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      return true;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return false;
    groups.push(Number.parseInt(part, 16));
    return true;
  };
  if (!left.every(append) || !right.every(append)) return null;
  if (halves.length === 1 && groups.length !== 8) return null;
  if (halves.length === 2) {
    const missing = 8 - groups.length;
    if (missing < 1) return null;
    const leftCount = left.reduce((count, part) => count + (part.includes(".") ? 2 : 1), 0);
    groups.splice(leftCount, 0, ...Array.from({ length: missing }, () => 0));
  }
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >>> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

const UNSAFE_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default",
  "internal",
]);

export function isPublicWebhookUrl(url: string, opts?: { allowLoopback?: boolean }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  const bare = host.replace(/^\[|\]$/g, "");
  const loopback = isLoopbackHost(bare);
  if (parsed.protocol !== "https:") {
    if (!(opts?.allowLoopback && parsed.protocol === "http:" && loopback)) return false;
  }
  if (UNSAFE_HOSTNAMES.has(host) && !(opts?.allowLoopback && loopback)) return false;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  if (isIP(bare)) return opts?.allowLoopback === true && loopback ? true : isPublicIpAddress(bare);
  return true;
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.startsWith("127.")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (isIP(host) !== 6) return false;
  const bytes = parseIpv6(host);
  return Boolean(
    bytes &&
    bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff &&
    bytes[12] === 127
  );
}
