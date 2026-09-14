import { createConnection } from "node:net";

/**
 * Minimal RESP ping over a raw socket. Deliberately dependency-free and
 * timeout-bounded: /ready must answer fast, and a health check that hangs is
 * a worse outage than one that reports degraded.
 */
export async function pingRedis(
  url: string,
  timeoutMs = 1500
): Promise<{ ok: boolean; detail: string }> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || 6379);
  } catch {
    return { ok: false, detail: "REDIS_URL is not a valid URL" };
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    let buffer = "";
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(false, `redis timeout after ${timeoutMs}ms`));
    socket.on("error", (err) => finish(false, `redis error: ${err.message}`));
    socket.on("connect", () => socket.write("PING\r\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("+PONG")) finish(true, "PING responded");
      else if (buffer.length > 64) finish(false, `unexpected reply: ${buffer.trim().slice(0, 32)}`);
    });
  });
}
