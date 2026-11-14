import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { pingRedis, probeCommands } from "./ping";

/**
 * The probe against a Redis that behaves like managed Redis.
 *
 * The bug these tests exist for: the probe connected and sent a bare `PING`.
 * A password-protected server answers `-NOAUTH Authentication required.`, so
 * /ready reported the queue degraded on every deployment — while the queue
 * client, which authenticates from the URL, was working. The health check was
 * the broken part, and it lied in the direction that makes an operator
 * distrust a working system.
 *
 * So the fake server below does exactly what Redis does: refuse anything but
 * AUTH until it has been authenticated.
 */

interface FakeRedis {
  url: string;
  server: Server;
  received: string[][];
}

const servers: FakeRedis[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (fake) =>
        new Promise<void>((resolve) => {
          fake.server.close(() => resolve());
        })
    )
  );
});

/** Splits `*2\r\n$4\r\nAUTH\r\n$6\r\nsecret\r\n` into [["AUTH","secret"]]. */
function parseResp(input: string): string[][] {
  const commands: string[][] = [];
  let rest = input;
  while (rest.length > 0) {
    const header = /^\*(\d+)\r\n/.exec(rest);
    if (!header) break;
    rest = rest.slice(header[0].length);
    const args: string[] = [];
    for (let i = 0; i < Number(header[1]); i++) {
      const bulk = /^\$(\d+)\r\n/.exec(rest);
      if (!bulk) return commands;
      const length = Number(bulk[1]);
      rest = rest.slice(bulk[0].length);
      args.push(rest.slice(0, length));
      rest = rest.slice(length + 2);
    }
    commands.push(args);
  }
  return commands;
}

/**
 * A redis that requires AUTH when `password` is set (and, when `username` is
 * set, requires Redis 6 ACL form). `failAfterAuth` simulates the server
 * rejecting a correct-looking password.
 */
async function startFakeRedis(
  options: { password?: string; username?: string; replyDelayMs?: number } = {}
): Promise<FakeRedis> {
  const received: string[][] = [];
  const server = createServer((socket: Socket) => {
    let buffer = "";
    let authenticated = !options.password;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const commands = parseResp(buffer);
      if (commands.length === 0) return;
      // Everything parsed has been answered; keep only the unparsed tail.
      buffer = "";
      for (const command of commands) {
        received.push(command);
        const reply = (line: string) => {
          if (options.replyDelayMs) setTimeout(() => socket.write(line), options.replyDelayMs);
          else socket.write(line);
        };
        const name = command[0]?.toUpperCase();
        if (name === "AUTH") {
          const ok =
            options.password !== undefined &&
            command.length >= 2 &&
            command[command.length - 1] === options.password &&
            (options.username === undefined || command[1] === options.username);
          if (ok) {
            authenticated = true;
            reply("+OK\r\n");
          } else {
            reply("-WRONGPASS invalid username-password pair or user is disabled.\r\n");
          }
          continue;
        }
        if (name === "PING") {
          reply(authenticated ? "+PONG\r\n" : "-NOAUTH Authentication required.\r\n");
          continue;
        }
        reply(`-ERR unknown command '${name}'\r\n`);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  const auth = options.password
    ? `${options.username ? `${options.username}:` : ":"}${options.password}@`
    : "";
  const fake = { url: `redis://${auth}127.0.0.1:${address.port}`, server, received };
  servers.push(fake);
  return fake;
}

describe("probeCommands", () => {
  it("sends only PING when the URL has no password", () => {
    expect(probeCommands("redis://127.0.0.1:6379")).toEqual([["PING"]]);
  });

  it("authenticates with the ACL form when a username is present", () => {
    expect(probeCommands("rediss://default:s3cret@redis.example.com:6379")).toEqual([
      ["AUTH", "default", "s3cret"],
      ["PING"],
    ]);
  });

  it("authenticates with the legacy single-argument form when the user is empty", () => {
    expect(probeCommands("redis://:s3cret@redis.example.com:6379")).toEqual([
      ["AUTH", "s3cret"],
      ["PING"],
    ]);
  });

  it("keeps percent-encoded characters intact", () => {
    expect(probeCommands("redis://default:pa%3Ass@host:6379")[0]).toEqual(["AUTH", "default", "pa:ss"]);
  });
});

describe("pingRedis against a password-protected redis", () => {
  it("authenticates, then pings", async () => {
    const fake = await startFakeRedis({ password: "s3cret", username: "default" });
    const result = await pingRedis(fake.url);

    expect(result).toEqual({ ok: true, detail: "PING responded" });
    expect(fake.received.map((c) => c[0])).toEqual(["AUTH", "PING"]);
  });

  it("reports what is missing when the URL carries no password", async () => {
    const fake = await startFakeRedis({ password: "s3cret" });
    const port = new URL(fake.url).port;
    const result = await pingRedis(`redis://127.0.0.1:${port}`);

    expect(result.ok).toBe(false);
    // The operator needs to know it is a missing credential, not a dead server.
    expect(result.detail).toMatch(/requires a password but REDIS_URL carries none/);
  });

  it("does not leak the password in the failure detail", async () => {
    const fake = await startFakeRedis({ password: "s3cret", username: "default" });
    const port = new URL(fake.url).port;
    const result = await pingRedis(`redis://default:wrong-password@127.0.0.1:${port}`);

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/rejected AUTH/);
    expect(result.detail).not.toContain("wrong-password");
  });

  it("still answers for a redis that needs no password", async () => {
    const fake = await startFakeRedis();
    expect(await pingRedis(fake.url)).toEqual({ ok: true, detail: "PING responded" });
  });

  it("gives up on a server that never replies", async () => {
    const fake = await startFakeRedis({ replyDelayMs: 5_000 });
    const result = await pingRedis(fake.url, 200);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/timeout/);
  });

  it("refuses a URL that is not a URL", async () => {
    expect(await pingRedis("not-a-url")).toEqual({
      ok: false,
      detail: "REDIS_URL is not a valid URL",
    });
  });
});
