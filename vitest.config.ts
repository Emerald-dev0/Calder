import { defineConfig } from "vitest/config";

export default defineConfig({
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
