import { defineConfig } from "vitest/config";

export default defineConfig({
  // Components are tested by rendering them, so .tsx files reach vitest through
  // esbuild. Next uses the automatic JSX runtime; match it here instead of
  // asking every component to import React for the sake of a test.
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    passWithNoTests: true,
    /**
     * Integration suites talk to a real Postgres and (with Redis configured) a
     * real Redis. The defaults (5s test / 10s hook) are shorter than a
     * container round trip under parallel load, which showed up as
     * "Hook timed out in 10000ms" failures on green suites. Suites still fail
     * loudly on a genuinely hung dependency: these are ceilings, not waits.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
