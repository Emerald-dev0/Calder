import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { colors, radius, spacing, typography } from "./tokens.js";

/**
 * Design-system gate (Phase 7 / M7.1: "tokens: emit all vars; lock floors").
 *
 * Two rules:
 *  1. Every token in tokens.ts is emitted in styles.css with the same value.
 *     A token that exists in JS but not CSS (or with a different hex) is a
 *     silent fork: half the product styles from the system, half from
 *     memory.
 *  2. Raw hex usage in the app trees is ratcheted. The floors below are
 *     measured, not aspirational — they may only move down. New components
 *     use var(--color-*) or the tokens import.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const CSS = readFileSync(join(HERE, "styles.css"), "utf8");

/** tokens.ts key → emitted custom property. */
const COLOR_VARS: Record<keyof typeof colors, string> = {
  ink: "--color-ink",
  paper: "--color-paper",
  surface: "--color-surface",
  muted: "--color-muted",
  calderBlue: "--color-accent",
  calderBlueLight: "--color-accent-bright",
  calderBlueMuted: "--color-accent-muted",
  signal: "--color-signal",
  border: "--color-border",
  borderStrong: "--color-border-strong",
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
};

function cssValue(name: string): string | undefined {
  const match = CSS.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

describe("design tokens: emitted vars", () => {
  it("emits every color token with the token's exact value", () => {
    for (const [key, value] of Object.entries(colors)) {
      const varName = COLOR_VARS[key as keyof typeof colors];
      expect(varName, `no var mapping for colors.${key}`).toBeTruthy();
      expect(cssValue(varName), `${varName} missing from styles.css`).toBe(value.toLowerCase());
    }
  });

  it("emits the spacing scale", () => {
    for (const [key, value] of Object.entries(spacing)) {
      expect(cssValue(`--space-${key}`), `--space-${key}`).toBe(value);
    }
  });

  it("emits the radius scale", () => {
    for (const [key, value] of Object.entries(radius)) {
      expect(cssValue(`--radius-${key}`), `--radius-${key}`).toBe(value);
    }
  });

  it("emits type roles (size/line/weight, plus tracking and mono family)", () => {
    for (const [role, spec] of Object.entries(typography)) {
      const s = spec as Record<string, unknown>;
      if (s.fontFamily) {
        expect(cssValue(`--type-${role}-family`), `--type-${role}-family`).toBe(s.fontFamily);
      } else {
        expect(cssValue(`--type-${role}-size`), `--type-${role}-size`).toBe(s.fontSize);
      }
      expect(cssValue(`--type-${role}-line`), `--type-${role}-line`).toBe(String(s.lineHeight));
      if (s.fontWeight !== undefined) {
        expect(cssValue(`--type-${role}-weight`), `--type-${role}-weight`).toBe(
          String(s.fontWeight)
        );
      }
      if (s.letterSpacing !== undefined) {
        expect(cssValue(`--type-${role}-tracking`), `--type-${role}-tracking`).toBe(
          String(s.letterSpacing)
        );
      }
    }
  });
});

describe("design tokens: consumers declare the system", () => {
  // Surfaces that consume the canonical token names must declare all of them;
  // a component referencing an undeclared var fails silently at render time.
  // (apps/web still carries its own legacy naming scheme — migrating it is
  // the remaining M7.1 slice, and it is deliberately not asserted here yet.)
  const CONSUMERS = ["apps/dashboard/app/globals.css"];

  for (const file of CONSUMERS) {
    it(`${file} declares every color token`, () => {
      const css = readFileSync(join(REPO_ROOT, file), "utf8");
      for (const varName of Object.values(COLOR_VARS)) {
        expect(
          new RegExp(`${varName}\\s*:`).test(css),
          `${file} is missing ${varName} — components using it style nothing`
        ).toBe(true);
      }
    });
  }

  it("no consumer references a var the system does not declare", () => {
    // Any var(--x) used in dashboard components must be declared somewhere in
    // the dashboard's own CSS, or be a Tailwind/shadcn-provided variable.
    const dashCss = readFileSync(join(REPO_ROOT, "apps/dashboard/app/globals.css"), "utf8");
    const controlCss = readFileSync(
      join(REPO_ROOT, "apps/dashboard/app/control/control.css"),
      "utf8"
    );
    const declared = new Set(
      [...`${dashCss}\n${controlCss}`.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1])
    );
    const used = new Set<string>();
    for (const file of sourceFiles(join(REPO_ROOT, "apps/dashboard"))) {
      if (file.endsWith(".css")) continue;
      for (const m of readFileSync(file, "utf8").matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        used.add(m[1]!);
      }
    }
    const undeclared = [...used].filter((v) => !declared.has(v)).sort();
    expect(
      undeclared,
      `dashboard components use vars nothing declares: ${undeclared.join(", ")}`
    ).toEqual([]);
  });
});

// ── Raw-hex ratchet ──────────────────────────────────────────────
// Measured 2026-09-25 (Phase 7 start). Lower is always allowed; raise only
// with a deliberate token-migration decision.
const HEX_BUDGET: Record<string, number> = {
  "apps/dashboard": 678,
  "apps/web": 97,
  "packages/ui": 41,
};

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo"]);
const SOURCE_EXT = [".ts", ".tsx", ".css"];
// The canonical definitions themselves, plus tests (which may assert on hex).
const SELF_EXEMPT = [/tokens\.ts$/, /styles\.css$/, /\.test\.tsx?$/];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SOURCE_EXT.some((ext) => entry.endsWith(ext))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function rawHexCount(dir: string): number {
  let total = 0;
  for (const file of sourceFiles(dir)) {
    const rel = relative(REPO_ROOT, file);
    if (SELF_EXEMPT.some((re) => re.test(rel))) continue;
    // `:root` blocks are declaration sites (the system stating its own values,
    // equivalent to tokens.ts), not usages. Everything else counts.
    const src = readFileSync(file, "utf8").replace(/:root\s*\{[^}]*\}/g, "");
    const matches = src.match(/#[0-9a-fA-F]{3,8}\b/g);
    total += matches?.length ?? 0;
  }
  return total;
}

describe("design tokens: raw hex floors", () => {
  for (const [dir, budget] of Object.entries(HEX_BUDGET)) {
    it(`${dir} stays within its raw-hex floor (${budget})`, () => {
      const actual = rawHexCount(join(REPO_ROOT, dir));
      expect(
        actual,
        `${dir} now has ${actual} raw hexes, above the ${budget} floor. ` +
          `Use var(--color-*) / tokens.ts; if a migration lowered the count, ` +
          `lower the floor in the same commit.`
      ).toBeLessThanOrEqual(budget);
    });
  }
});
