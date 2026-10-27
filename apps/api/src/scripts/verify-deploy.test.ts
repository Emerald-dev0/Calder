import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The post-deploy verifier is the last thing standing between a bad deployment
 * and a live send, so the behaviour under test is its *refusals*: a non-test key
 * must never produce an HTTP send, and a red check must produce a non-zero exit
 * rather than a printed warning.
 *
 * These run the real script (it is a process-level reporter; importing it would
 * execute main() at import time) against a throwaway HTTP server that records
 * every request it ever sees. Nothing here talks to a provider or a real host.
 */

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "verify-deploy.ts");
const packageDir = dirname(dirname(dirname(scriptPath))); // .../apps/api/src/scripts → apps/api

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string;
  body: string;
}

type Routes = Record<string, (res: ServerResponse, req: IncomingMessage) => void>;

function healthy(routes: Partial<Routes> = {}): Routes {
  return {
    "GET /health": (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    },
    "GET /ready": (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ready",
          checks: { database: { state: "ok" }, queue: { state: "ok" } },
        })
      );
    },
    "GET /v1/openapi.json": (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ openapi: "3.1.0", paths: { "/v1/emails": { post: {} } } }));
    },
    "POST /v1/emails": (res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "unauthorized" } }));
    },
    ...routes,
  };
}

let server: ReturnType<typeof createServer>;
let baseUrl = "";
let requests: RecordedRequest[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const key = `${req.method} ${req.url?.split("?")[0]}`;
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: String(req.headers.authorization ?? ""),
        body,
      });
      const handler = (server as unknown as { __routes?: Routes }).__routes?.[key];
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "not_found", route: key } }));
        return;
      }
      handler(res, req);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no test port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

async function run(
  args: string[],
  routes: Routes
): Promise<{ exit: number; out: string; sent: RecordedRequest[] }> {
  (server as unknown as { __routes: Routes }).__routes = routes;
  requests = [];
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: "postgresql://x/y",
  };
  // Deleted, not blanked: an empty ADMIN_API_KEY is a validation failure, not an
  // absent one. Both of these branch the report, so the run must be deterministic
  // whatever the invoking shell happens to export.
  delete childEnv.CRON_SECRET;
  delete childEnv.ADMIN_API_KEY;

  // Async on purpose. The harness server shares this process, so spawnSync would
  // park the event loop for the whole run and every one of the child's requests
  // would time out against a server that cannot answer.
  const { code, out } = await new Promise<{ code: number; out: string }>((done, fail) => {
    const child = spawn("pnpm", ["exec", "tsx", scriptPath, "--url", baseUrl, ...args], {
      cwd: packageDir,
      env: childEnv,
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? -1, out }));
  });

  // The auth-rejection probe POSTs /v1/emails too, deliberately unauthenticated.
  // The invariant is about an *authenticated* send, so only count those.
  return {
    exit: code,
    out,
    sent: requests.filter((r) => r.method === "POST" && r.authorization !== ""),
  };
}

describe("verify:deploy refusals", () => {
  it("passes a healthy deployment and sends nothing without a test key", async () => {
    const { exit, out, sent } = await run([], healthy());
    expect(out).toContain("liveness: /health answers 200");
    expect(out).toContain("safe test send");
    expect(out).toContain("no test key supplied");
    expect(sent).toHaveLength(0);
    // Skips are counted, never folded into the pass total as quiet successes.
    expect(out).toMatch(/0 failed/);
    expect(exit).toBe(0);
  }, 120_000);

  it("refuses a live key without ever reaching the send endpoint", async () => {
    const { exit, out, sent } = await run(["--test-key", "calder_sk_live_deadbeef"], healthy());
    expect(out).toContain("safe test send: refusing a non-test key");
    expect(sent).toHaveLength(0);
    expect(exit).toBe(1);
  }, 120_000);

  it("posts exactly one mock send with a test key and nothing else", async () => {
    const { exit, out, sent } = await run(
      ["--test-key", "calder_sk_test_deadbeef"],
      healthy({
        // One route, two callers: the auth probe hits /v1/emails unauthenticated
        // and must still see 401, or that check fails the run for the wrong
        // reason.
        "POST /v1/emails": (res, req) => {
          if (!req.headers.authorization) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: { code: "unauthorized" } }));
            return;
          }
          res.writeHead(202, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "eml_test_1", status: "queued" }));
        },
      })
    );
    expect(out).toContain("safe test send: accepted as eml_test_1");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorization).toBe("Bearer calder_sk_test_deadbeef");
    expect(JSON.parse(sent[0]?.body ?? "{}")).toMatchObject({ subject: expect.any(String) });
    expect(exit).toBe(0);
  }, 120_000);

  it("exits non-zero when the deployment is not live", async () => {
    const { exit, out } = await run(
      [],
      healthy({
        "GET /health": (res) => {
          res.writeHead(500);
          res.end("nope");
        },
      })
    );
    expect(out).toContain("liveness: /health returned 500");
    expect(out).toContain("Post-deploy verification FAILED");
    expect(exit).toBe(1);
  }, 120_000);
});
