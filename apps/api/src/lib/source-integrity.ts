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
