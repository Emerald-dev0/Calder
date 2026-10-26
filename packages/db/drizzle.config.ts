import { defineConfig } from "drizzle-kit";

/**
 * `schema` points at the built output on purpose.
 *
 * drizzle-kit 0.30 loads a TypeScript config by `require`-ing the `schema` path
 * through its own bundled CJS loader, which cannot resolve the `.js` specifiers
 * every file in `src/schema/` uses (`export * from "./enums.js"` against a
 * `.ts` file). So `pnpm db:generate` dies with `Cannot find module './enums.js'`
 * — and at 0.30.6 it still **exits 0** while printing the error, which means a
 * CI step that reads only the exit code reports green and produces no
 * migration. `dist/schema/index.js` is the same module graph, already resolved.
 *
 * The cost is that `dist` can be stale, so `db:generate` builds first and
 * `db:drift` re-runs generation in a scratch folder and fails if the committed
 * migrations do not cover the schema.
 */
export default defineConfig({
  schema: "./dist/schema/index.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://calder:calder@localhost:5432/calder",
  },
  verbose: true,
  strict: true,
});
