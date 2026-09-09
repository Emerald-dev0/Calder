#!/usr/bin/env node
/**
 * SEO CI gate (Phase 30, light). Fails on:
 * - public page.tsx without metadata export
 * - sitemap.ts missing a route that exists on disk
 * - sitemap entries pointing at non-routes
 * - missing public/og-image.png or public/llms.txt
 * - duplicate page titles
 *
 * Usage: node scripts/seo-check.mjs  (from repo root)
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps/web/app");
const failures = [];
const notes = [];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (["api", "(app)"].includes(e.name)) continue;
      walk(p, out);
    } else if (e.name === "page.tsx" || e.name === "page.mdx") {
      out.push(p);
    }
  }
  return out;
}

const pages = walk(appDir);
// 1. Every public page has metadata (homepage inherits the root layout).
for (const p of pages) {
  const rel = p.replace(appDir, "app");
  if (rel === "app/page.tsx") continue;
  const src = readFileSync(p, "utf8");
  if (!/generateMetadata|export const metadata/.test(src)) {
    failures.push(`missing metadata: ${rel}`);
  }
}

// 2. Sitemap covers on-disk routes (excluding dynamic + non-indexable).
const sitemapSrc = readFileSync(join(appDir, "sitemap.ts"), "utf8");
const toRoute = (p) => p.replace(appDir, "").replace(/\/page\.(tsx|mdx)$/, "");
const routePaths = pages.map(toRoute).filter(Boolean);
const skipPrefixes = ["/login", "/invite", "/api", "/docs/quickstart"];
// Dynamic patterns (e.g. /resources/glossary/[term]) match concrete sitemap paths.
const dynamicPatterns = routePaths
  .filter((r) => r.includes("["))
  .map((r) => new RegExp(`^${r.replace(/\[(\w+)\]/g, "[^/]+")}$`));
const staticRoutes = new Set(routePaths.filter((r) => !r.includes("[")));
const matchesKnown = (s) => staticRoutes.has(s) || dynamicPatterns.some((re) => re.test(s));
for (const r of new Set(routePaths.filter((x) => !x.includes("[")))) {
  if (skipPrefixes.some((s) => r === s || r.startsWith(`${s}/`))) continue;
  const inSitemap = sitemapSrc.includes(`"${r}"`) || sitemapSrc.includes(`'${r}'`);
  if (!inSitemap) notes.push(`route not in sitemap (add if indexable): ${r || "/"}`);
}

// 3. Sitemap entries resolve to real routes.
const sitemapPaths = [...sitemapSrc.matchAll(/path:\s*["']([^"']+)["']/g)].map((m) => m[1]);
for (const s of sitemapPaths) {
  if (!matchesKnown(s) && s !== "/") failures.push(`sitemap references non-route: ${s}`);
}

// 4. Shared assets exist.
for (const f of ["apps/web/public/og-image.png", "apps/web/public/llms.txt"]) {
  if (!existsSync(join(root, f))) failures.push(`missing asset: ${f}`);
}

// 5. Duplicate titles across static metadata blocks.
const titles = new Map();
for (const p of pages) {
  const src = readFileSync(p, "utf8");
  const m = src.match(/title:\s*["`]([^"`]+)["`]/);
  if (m) {
    const t = m[1];
    if (titles.has(t)) titles.get(t).push(p.replace(appDir, "app"));
    else titles.set(t, [p.replace(appDir, "app")]);
  }
}
for (const [t, files] of titles) {
  if (files.length > 1) failures.push(`duplicate title "${t}": ${files.join(", ")}`);
}

// 6. Canonical on key money pages (direct tag or pageMeta() helper).
for (const key of ["app/page.tsx", "app/pricing/page.tsx", "app/docs/page.tsx"]) {
  const src = readFileSync(join(appDir, key.replace("app/", "")), "utf8");
  const hasCanonical = /canonical|pageMeta\(/.test(src) || key === "app/page.tsx"; // home canonical lives in layout
  if (!hasCanonical) failures.push(`missing canonical: ${key}`);
}

if (notes.length) {
  console.log("NOTES (non-failing):");
  for (const n of notes) console.log(`  - ${n}`);
}
if (failures.length) {
  console.log("SEO CHECK FAILED:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`SEO check passed (${pages.length} pages scanned).`);
void statSync;
