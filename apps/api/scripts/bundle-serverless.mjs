/**
 * Bundle the Vercel serverless function into a single self-contained ESM file.
 *
 * Why: Vercel's function runtime executes plain Node — it does not compile
 * TypeScript from symlinked workspace packages, and this monorepo's packages
 * export their TS sources (apps run them via tsx/Next.js/vitest). Shipping
 * raw sources crashed the function at boot (ERR_MODULE_NOT_FOUND on
 * @calder/observability/src/index.ts).
 *
 * Strategy: compile `@calder/*` workspace sources into the bundle via the
 * plugin below; every real npm dependency (hono, pino, postgres, ioredis,
 * bullmq, @aws-sdk, …) stays external so Vercel traces and ships it from
 * node_modules as usual. esbuild is already in the dependency tree (vitest).
 *
 * Output: `api/index.js` (+ sourcemap), gitignored, shipped by Vercel.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Resolve `@calder/*` imports to package TS sources so they get bundled. */
const calderWorkspaceSources = {
  name: "calder-workspace-sources",
  setup(build) {
    build.onResolve({ filter: /^@calder\// }, (args) => {
      const [, pkg, ...rest] = args.path.split("/");
      const sub = rest.length > 0 ? rest.join("/") : "index.ts";
      return { path: join(root, "..", "..", "packages", pkg, "src", sub) };
    });
  },
};

await build({
  entryPoints: [join(root, "src", "serverless.ts")],
  outfile: join(root, "api", "index.js"),
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "node20",
  packages: "external",
  sourcemap: true,
  plugins: [calderWorkspaceSources],
  logLevel: "info",
});
