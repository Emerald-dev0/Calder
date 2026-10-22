/**
 * Source-integrity detectors.
 *
 * Kept in a plain module (not the test) so the rule table is importable by
 * tooling, and — deliberately — so the gate scans its own rule definitions.
 * Only the gate's test file is excluded from the scan, because it has to build
 * live-looking samples to prove each rule fires. Because of that, this file
 * describes the payloads without reproducing their tokens or markers; the
 * marker values are assembled from fragments below.
 *
 * History — two outbreaks, both appended to build tooling:
 *
 *   2026-09 (PR #38): the September marker pair, a base64 decode handed to
 *   eval. Its first effect replaced every console method with a no-op,
 *   silently killing observability for anything loaded afterwards.
 *
 *   2026-10 (c01301f): 2026-10 markers, nine files in one commit, two
 *   encodings — an eval wrapping a base64 decode in the six TypeScript build
 *   scripts, and an inline character-rotation decoder with no eval or atob
 *   token at all in the three .mjs files. Each was appended to the final line
 *   behind ~2,000 spaces of padding, which is what pushed it out of view in
 *   review.
 *
 * The 2026-10 .mjs variant is why the rules are shape-based rather than a list
 * of tokens: an inline decoder contains neither eval nor atob. Rule 7
 * (padding) and rule 6 (global rewrites) are what catch that family, and rule 8
 * (long line) catches it even when the padding is dropped — the payloads were
 * 6.8k and 11.1k characters on a single line, while the longest legitimate
 * source line in this repo is ~500.
 */

/** The two marker pairs, assembled from fragments so no literal token exists. */
export const MARKERS: readonly string[] = [
  ["5", "1517", "du"].join("-"),
  ["_$", "2479"].join("_"),
  ["5", "1795", "du"].join("-"),
  ["_$", "45f3"].join("_"),
];

const MARKER_PATTERN = MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

export interface Rule {
  name: string;
  /** Tested line by line. */
  line?: RegExp;
  /** Tested against the whole file (for blobs and markers). */
  file?: RegExp;
}

export const RULES: readonly Rule[] = [
  {
    name: "eval / new Function / atob",
    // "e" + "val" concatenation appears nowhere: the literal token is what
    // we scan for, and this file must pass its own gate.
    line: /\beval\s*\(|new\s+Function\s*\(|\batob\s*\(/,
  },
  {
    name: "long base64 blob",
    // Base64 alphabet runs; 1500+ chars is far beyond any hand-written string.
    file: /[A-Za-z0-9+/]{1500,}={0,2}/,
  },
  {
    name: "console monkey-patching",
    line: /\bconsole\s*\[[^\]]+\]\s*=|\bconsole\.\w+\s*=\s*/,
  },
  {
    name: "known injection marker",
    file: new RegExp(MARKER_PATTERN),
  },
  {
    name: "eval of encoded string",
    // An eval whose argument decodes an encoded string: a base64 decoder,
    // Buffer.from(...,"base64") or String.fromCharCode — the October shape.
    line: /\beval\s*\([^)]{0,200}(?:\batob\s*\(|Buffer\s*\.\s*from\s*\(|String\s*\.\s*fromCharCode\s*\()/,
  },
  {
    name: "global object rewrite",
    // Assigning to the global require, module or __dirname binding: the
    // payload used this to install its own loader globals.
    line: /\bglobal(?:This)?\s*\.\s*(?:require|module|__dirname|__filename)\b\s*=/,
  },
  {
    name: "abnormal whitespace padding",
    // ≥120 spaces/tabs followed by more code on the same line. Ordinary
    // alignment never reaches this; the October payload used ~2,000.
    line: /[ \t]{120,}\S/,
  },
  {
    name: "abnormally long source line",
    // A single source line over 1,500 characters. The longest legitimate line
    // in this repo is ~500; the October payloads were 6.8k and 11.1k on one
    // line, so this catches the variant even with its padding removed and its
    // marker changed. Generated assets are exempt via BASE64_ALLOWED.
    line: /^.{1500,}$/,
  },
];

/** Rule names matched by `text`. Pure, so controls can exercise it. */
export function violationsIn(text: string): string[] {
  const lines = text.split("\n");
  const hits = new Set<string>();
  for (const rule of RULES) {
    if (rule.file && rule.file.test(text)) hits.add(rule.name);
    if (rule.line && lines.some((l) => rule.line!.test(l))) hits.add(rule.name);
  }
  return [...hits];
}

/** True when `file` matches `rule` — used by the repo scan. */
export function fileViolates(rule: Rule, text: string): boolean {
  if (rule.file && rule.file.test(text)) return true;
  return Boolean(rule.line && text.split("\n").some((l) => rule.line!.test(l)));
}

// ── Non-source file checks ───────────────────────────────────────────────────
//
// The payload family targets whatever a developer's toolchain will execute
// without asking, so the gate cannot look only at *.ts. These three checks
// cover the other doors:
//
//   A. `.vscode/tasks.json` with runOn: "folderOpen" — VS Code runs the task
//      the moment the folder is opened, so cloning and opening the repo is
//      enough to execute it. No prompt, no review.
//   B. A .woff/.woff2 whose first bytes are not the container signature — a
//      font path is loaded by the browser at render time, and a font file is
//      never inspected by a reviewer.
//   C. Appended code after a long whitespace run in build config files
//      (next/tailwind/postcss/eslint/vite/babel/vitest/turbo). These are
//      executed by the toolchain itself on every build, and the padding is
//      what pushes the tail out of a diff's visible width.

/** VS Code's automatic task execution switch. Assembled to avoid self-tripping. */
export const FOLDER_OPEN_KEY = ["run", "On"].join("");

/** True when a `.vscode/tasks.json` would auto-run a task on folder open. */
export function hasFolderOpenTask(path: string, text: string): boolean {
  if (!/(^|\/)\.vscode\/tasks\.json$/.test(path)) return false;
  // Both "runOn": "folderOpen" and runOn into folderOpen across JSON5-ish text.
  const re = new RegExp(`"${FOLDER_OPEN_KEY}"\\s*:\\s*"folderOpen"`);
  return re.test(text);
}

const FONT_EXT = /\.(woff2?|ttf|otf|eot)$/i;

/**
 * Font container signatures. A .woff that does not begin with one is either
 * corrupt or is not a font at all; both are worth failing on, because nothing
 * else in the pipeline reads the file's contents.
 */
export function fontSignatureProblem(path: string, bytes: Buffer): string | null {
  const ext = path.toLowerCase().match(FONT_EXT)?.[1];
  if (!ext) return null;
  const want =
    ext === "woff2"
      ? "wOF2"
      : ext === "woff"
        ? "wOFF"
        : ext === "ttf"
          ? "\u0000\u0001\u0000\u0000"
          : ext === "otf"
            ? "OTTO"
            : "wOFF"; // eot has no stable magic; require wOFF-adjacent text
  const head = bytes.subarray(0, want.length).toString("latin1");
  if (head === want) return null;
  return `expected signature ${JSON.stringify(want)}, found ${JSON.stringify(head)}`;
}

/**
 * Build-config files the toolchain executes on every run. Deliberately a
 * name list rather than "any *.config.*": the risk is a tail appended where a
 * reviewer will not scroll, and these are the files that actually run.
 */
const CONFIG_FILE =
  /(^|\/)(next|tailwind|postcss|eslint|vite|vitest|babel|tsup|rollup|webpack)\.config\.(js|mjs|cjs|ts|mts|cts)$|(^|\/)\.eslintrc\.(js|cjs|json|ya?ml)$|(^|\/)turbo\.json$/;

/** ≥80 spaces of padding with something after it, in an executed config file. */
export function configTailPadding(path: string, text: string): string | null {
  if (!CONFIG_FILE.test(path)) return null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/[ \t]{80,}\S/.test(line)) return `line ${i + 1} has padding followed by code`;
  }
  return null;
}
