import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  symlinkSync,
} from "node:fs";
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
  const check = () =>
    spawnSync(process.execPath, [join(root, "scripts/assert-bundle.mjs")], {
      cwd,
      encoding: "utf8",
    });
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

test("serverless bundle boots and serves health/OpenAPI without source JSON", () => {
  const build = spawnSync(process.execPath, [join(root, "scripts/bundle-serverless.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr);
  const isolated = mkdtempSync(join(tmpdir(), "calder-isolated-function-"));
  try {
    copyFileSync(join(root, "dist/serverless.js"), join(isolated, "serverless.mjs"));
    // Only installed external packages are available; no source tree or JSON.
    symlinkSync(join(root, "node_modules"), join(isolated, "node_modules"), "dir");
    const expectedSpec = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8"));
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from "node:assert/strict";
      import handler from "./serverless.mjs";
      const health = await handler.fetch(new Request("https://api.calder.click/health"));
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, "ok");
      const openapi = await handler.fetch(new Request("https://api.calder.click/v1/openapi.json"));
      assert.equal(openapi.status, 200);
      console.log("SPEC:" + JSON.stringify(await openapi.json()));
      process.exit(0);
    `,
      ],
      {
        cwd: isolated,
        env: { PATH: process.env.PATH, NODE_ENV: "test", CALDER_ENV: "test" },
        encoding: "utf8",
        timeout: 30_000,
      }
    );
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const specLine = run.stdout.split("\n").find((line) => line.startsWith("SPEC:"));
    assert.ok(specLine, "OpenAPI response was printed");
    assert.deepEqual(JSON.parse(specLine.slice(5)), expectedSpec);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});
