#!/usr/bin/env node
/**
 * Local development infrastructure runner.
 *
 * Boots a self-contained PostgreSQL 17 for environments where Docker /
 * system packages are unavailable (sandboxed previews). DEV TOOLING ONLY —
 * production uses managed Postgres via DATABASE_URL and never runs this.
 *
 *   node scripts/dev-infra.mjs start   # init (if needed) + start server
 *   node scripts/dev-infra.mjs stop
 *
 * Env: CALDER_PGDATA (default ~/.cache/calder-pgdata), CALDER_PGPORT (5432)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dataDir = process.env.CALDER_PGDATA ?? join(homedir(), ".cache", "calder-pgdata");
const port = String(process.env.CALDER_PGPORT ?? 5432);

// The platform binaries ship inside @embedded-postgres/linux-x64.
let binDir;
for (const candidate of [
  join(process.cwd(), "node_modules/@embedded-postgres/linux-x64/native/bin"),
  "node_modules/.pnpm/@embedded-postgres+linux-x64@17.4.0-beta.15/node_modules/@embedded-postgres/linux-x64/native/bin",
]) {
  if (existsSync(join(candidate, "pg_ctl"))) {
    binDir = candidate;
    break;
  }
}
if (!binDir) {
  console.error("Could not locate @embedded-postgres/linux-x64 binaries. Run: pnpm install");
  process.exit(1);
}
const pgctl = join(binDir, "pg_ctl");
const initdb = join(binDir, "initdb");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  return res.status === 0;
}

const mode = process.argv[2] ?? "start";

if (mode === "stop") {
  process.exit(run(pgctl, ["-D", dataDir, "-m", "fast", "stop"]) ? 0 : 1);
}

if (!existsSync(join(dataDir, "PG_VERSION"))) {
  mkdirSync(dataDir, { recursive: true });
  console.log("initializing cluster…");
  if (!run(initdb, ["-D", dataDir, "-U", "calder", "--auth=trust"])) process.exit(1);
}

console.log(`starting postgres on 127.0.0.1:${port}…`);
const logFile = join(dataDir, "server.log");
if (
  !run(pgctl, [
    "-D",
    dataDir,
    "-l",
    logFile,
    "-o",
    `-p ${port} -c listen_addresses=127.0.0.1`,
    "start",
  ])
) {
  console.error("pg_ctl start failed — see server.log");
  process.exit(1);
}
console.log("postgres ready. data:", dataDir, "log:", logFile);
