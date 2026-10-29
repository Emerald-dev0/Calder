import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../../next.config.mjs";

for (const environment of ["development", "test", "production"]) {
  test(`CSP in ${environment} preserves the intended evaluation boundary`, async () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = environment;
      const rules = await config.headers();
      const headers = rules[0].headers;
      const csp = headers.find((header) => header.key === "Content-Security-Policy").value;
      assert.equal(csp.includes("'unsafe-eval'"), environment === "development");
      assert.ok(csp.includes("frame-ancestors 'none'"));
      assert.ok(csp.includes("object-src 'none'"));
      assert.equal(
        headers.some((header) => header.key === "Strict-Transport-Security"),
        environment === "production"
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
}
