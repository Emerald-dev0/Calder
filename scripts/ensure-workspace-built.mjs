#!/usr/bin/env node
/**
 * Build the workspace packages this app depends on, if their compiled output
 * is missing.
 *
 * Why this exists: every `@calder/*` package exports `./dist/index.js`, so an
 * app can only be compiled once its dependencies are. A monorepo build through
 * turbo already does that (`build` dependsOn `^build`), but a *platform build of
 * one app* does not. With Vercel's Root Directory set to `apps/web`, the build
 * runs `next build` in that directory and nothing has been compiled yet:
 *
 *     Module not found: Can't resolve '@calder/config/plan-limits'
 *
 * This prebuild step closes that gap by asking turbo to build exactly this
 * app's upstream dependencies. It is a no-op when every dependency's `main`
 * file is already present, so the turbo path builds each package once and two
 * parallel app builds can never race the same `tsc` into one output directory.
 *
 * DEV/DEPLOY TOOLING ONLY. Nothing at runtime reads this file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** name → directory, for every workspace package. */
const packages = new Map();
for (const group of ["apps", "packages"]) {
  const base = join(root, group);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(base, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = readJson(pkgPath);
      if (pkg.name) packages.set(pkg.name, join(base, entry.name));
    } catch {
      // A malformed package.json is a failure the app's own build will report.
    }
  }
}

/** Workspace-protocol dependencies of one package. */
function workspaceDeps(pkg) {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return Object.entries(all)
    .filter(([, spec]) => typeof spec === "string" && spec.startsWith("workspace:"))
    .map(([name]) => name);
}

/** Every transitive workspace dependency of `name`. */
function closure(name) {
  const seen = new Set();
  const stack = [...workspaceDeps(readJson(join(packages.get(name), "package.json")))];
  while (stack.length > 0) {
    const dep = stack.pop();
    if (seen.has(dep)) continue;
    seen.add(dep);
    const dir = packages.get(dep);
    if (!dir) continue; // external, or a typo the compiler will surface
    stack.push(...workspaceDeps(readJson(join(dir, "package.json"))));
  }
  return [...seen];
}

/** The file Node loads for a package, or null when it exports no build. */
function builtEntry(name) {
  const dir = packages.get(name);
  if (!dir) return null;
  const pkg = readJson(join(dir, "package.json"));
  if (!pkg.main) return null; // source-only package: nothing to build
  return join(dir, pkg.main);
}

const isMissing = (name) => {
  const entry = builtEntry(name);
  return entry !== null && !existsSync(entry);
};

const appName = readJson(join(process.cwd(), "package.json")).name;
if (!appName || !packages.has(appName)) {
  console.error(`ensure-workspace-built: ${process.cwd()} is not a workspace package`);
  process.exit(1);
}

const deps = closure(appName);
const missing = deps.filter(isMissing);

if (missing.length === 0) {
  const count = `${deps.length} workspace dependenc${deps.length === 1 ? "y" : "ies"}`;
  console.log(`ensure-workspace-built: ${count} already built, nothing to do`);
  process.exit(0);
}

console.log(
  `ensure-workspace-built: building upstream dependencies of ${appName} ` +
    `(${missing.length} missing: ${missing.join(", ")})`
);

// `<pkg>^...` selects the app's direct dependencies and nothing else. Turbo's
// own `dependsOn: ["^build"]` then pulls their dependencies in, so this builds
// the whole upstream graph but never the app itself — running the app's build
// here would recurse through this very prebuild hook.
const build = spawnSync("pnpm", ["exec", "turbo", "run", "build", "--filter", `${appName}^...`], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (build.status !== 0) {
  console.error("ensure-workspace-built: dependency build failed");
  process.exit(build.status ?? 1);
}

const stillMissing = missing.filter(isMissing);
if (stillMissing.length > 0) {
  console.error(`ensure-workspace-built: still missing after build: ${stillMissing.join(", ")}`);
  process.exit(1);
}

console.log("ensure-workspace-built: done");
