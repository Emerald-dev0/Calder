import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("Vercel rewrite targets a source entry importing the generated bundle", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert.equal(config.rewrites[0].destination, "/api/index.js");
  const entry = readFileSync(join(root, "api/index.js"), "utf8");
  assert.match(entry, /export \{ default, maxDuration \} from "\.\.\/dist\/serverless\.js"/);
  const bundler = readFileSync(join(root, "scripts/bundle-serverless.mjs"), "utf8");
  assert.match(bundler, /outfile: join\(root, "dist", "serverless.js"\)/);
});

test("build guard rejects missing/truncated bundles and accepts generated output", () => {
  const cwd = mkdtempSync(join(tmpdir(), "calder-bundle-"));
  const check = () => spawnSync(process.execPath, [join(root, "scripts/assert-bundle.mjs")], { cwd, encoding: "utf8" });
  try {
    assert.equal(check().status, 1);
    mkdirSync(join(cwd, "dist"));
    writeFileSync(join(cwd, "dist/serverless.js"), "export default {};");
    assert.equal(check().status, 1);
    writeFileSync(join(cwd, "dist/serverless.js"), "x".repeat(100_000));
    assert.equal(check().status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
