import { createConnection, type Socket } from "node:net";

/**
 * Minimal RESP probe over a raw socket. Deliberately dependency-free and
 * timeout-bounded: /ready must answer fast, and a health check that hangs is
 * a worse outage than one that reports degraded.
 *
 * Shared by the API and the worker (moved here from apps/api in Phase 2 so
 * both processes use one implementation).
 *
 * ## Why this authenticates
 *
 * The probe used to connect and send a bare `PING`. Against any Redis that
 * requires a password the server answers `-NOAUTH Authentication required.`,
 * and the probe reported the whole queue as degraded — while the queue client
 * (ioredis, which does authenticate from the URL) was working fine. Managed
 * Redis is password-protected by default, so "degraded" was the only thing
 * /ready could ever say: a health check that lied, in the direction that makes
 * an operator distrust a working system.
 *
 * Credentials live in the URL, so they are used here exactly as ioredis uses
 * them: `AUTH <user> <pass>` when a username is present (Redis 6 ACL, what
 * Upstash issues), `AUTH <pass>` otherwise (legacy single-argument form). Both
 * are sent as a RESP array rather than an inline command, so a password
 * containing spaces or punctuation survives intact.
 *
 * A detail string never contains the password: these strings are rendered in
 * /ready and shipped to alerting, and a credential in a health response is a
 * leak that outlives the incident.
 */

export interface RedisPingResult {
  ok: boolean;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 1500;

/** Enough for a handshake reply; anything longer is not a Redis greeting. */
const MAX_REPLY_BYTES = 512;

interface Endpoint {
  host: string;
  port: number;
}

function parseEndpoint(url: string): Endpoint | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return { host: parsed.hostname, port: Number(parsed.port || 6379) };
  } catch {
    return null;
  }
}

function credentials(url: string): { username: string; password: string } {
  try {
    const parsed = new URL(url);
    return {
      username: decodeURIComponent(parsed.username ?? ""),
      password: decodeURIComponent(parsed.password ?? ""),
    };
  } catch {
    return { username: "", password: "" };
  }
}

/** RESP array of bulk strings — safe for any password. */
function encodeCommand(args: string[]): string {
  const parts = args.map((arg) => `$${Buffer.byteLength(arg, "utf8")}\r\n${arg}\r\n`);
  return `*${args.length}\r\n${parts.join("")}`;
}

/**
 * The commands a probe must send, in order. Exported so the encoding is
 * testable without a socket: this is the part that was missing, and it is the
 * part a future edit is most likely to get wrong.
 */
export function probeCommands(url: string): string[][] {
  const { username, password } = credentials(url);
  if (!password) return [["PING"]];
  return [username ? ["AUTH", username, password] : ["AUTH", password], ["PING"]];
}

/** Strips anything that looks like the configured password from a server error. */
function redact(detail: string, url: string): string {
  const { password } = credentials(url);
  return password ? detail.split(password).join("***") : detail;
}

function describeFailure(reply: string, url: string, authenticated: boolean): RedisPingResult {
  const message = redact(reply.replace(/^[-+]/, "").trim(), url);
  if (/NOAUTH/i.test(message)) {
    return authenticated
      ? { ok: false, detail: `redis rejected AUTH: ${message}` }
      : {
          ok: false,
          detail: "redis requires a password but REDIS_URL carries none",
        };
  }
  if (/WRONGPASS|invalid password/i.test(message)) {
    return { ok: false, detail: `redis rejected AUTH: ${message}` };
  }
  return { ok: false, detail: `redis error: ${message.slice(0, 120)}` };
}

/**
 * Connects, authenticates when the URL has credentials, then PINGs.
 * `open` is the transport: plain TCP or TLS. Everything else is shared, so the
 * two entry points below cannot drift apart again.
 */
function probe(
  url: string,
  open: (endpoint: Endpoint) => Socket,
  readyEvent: "connect" | "secureConnect",
  timeoutMs: number
): Promise<RedisPingResult> {
  const endpoint = parseEndpoint(url);
  if (!endpoint) return Promise.resolve({ ok: false, detail: "REDIS_URL is not a valid URL" });

  const commands = probeCommands(url);
  const authenticated = commands.length > 1;

  return new Promise((resolve) => {
    let socket: Socket;
    try {
      socket = open(endpoint);
    } catch (err) {
      resolve({ ok: false, detail: `redis error: ${(err as Error).message}` });
      return;
    }

    let settled = false;
    let sent = 0;
    let buffer = "";

    const finish = (result: RedisPingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const sendNext = () => {
      const command = commands[sent];
      if (!command) return;
      sent++;
      socket.write(encodeCommand(command));
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish({ ok: false, detail: `redis timeout after ${timeoutMs}ms` }));
    socket.on("error", (err: Error) =>
      finish({ ok: false, detail: `redis error: ${err.message}` })
    );
    // A TLS socket must not be written to before its handshake; it emits
    // `secureConnect` for that. A plain socket only ever emits `connect`.
    socket.on(readyEvent, sendNext);

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\r\n");

        if (line.startsWith("-")) {
          finish(describeFailure(line, url, authenticated));
          return;
        }
        if (line === "+PONG") {
          finish({ ok: true, detail: "PING responded" });
          return;
        }
        if (line.startsWith("+")) {
          // `+OK` (and anything else affirmative) means the current command was
          // accepted; move to the next one. The last command is the PING.
          if (sent < commands.length) sendNext();
          continue;
        }
        // Integers and bulk-string headers are progress, not answers.
      }

      if (buffer.length > MAX_REPLY_BYTES) {
        finish({ ok: false, detail: `unexpected reply: ${buffer.trim().slice(0, 32)}` });
      }
    });
  });
}

/** Plain TCP probe: `redis://`, including URLs that carry credentials. */
export function pingRedis(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RedisPingResult> {
  return probe(
    url,
    (endpoint) => createConnection({ host: endpoint.host, port: endpoint.port }),
    "connect",
    timeoutMs
  );
}

/** TLS-aware variant: `rediss://` gets a TLS socket, everything else is reusable. */
export async function pingRedisUrl(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RedisPingResult> {
  if (!url.startsWith("rediss://")) return pingRedis(url, timeoutMs);
  const { connect } = await import("node:tls");
  return probe(
    url,
    (endpoint) =>
      connect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host }) as Socket,
    "secureConnect",
    timeoutMs
  );
}
