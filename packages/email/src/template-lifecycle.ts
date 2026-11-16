/**
 * Template lifecycle: drafts, published versions, declared variables.
 *
 * The editor used to write a version and have it live immediately, so there was
 * no state in which a template existed but could not be sent. Three things
 * follow from that and all of them are customer-visible:
 *
 *  - a half-written edit is sendable — the moment someone saves, every send
 *    using the alias picks it up;
 *  - nothing checks the thing before it goes out. A template with no subject,
 *    no body, or `{{first_name}}` where the sender passes `firstName` fails at
 *    send time, once per recipient;
 *  - "roll back" is a fiction, because there is no distinction between the old
 *    version and the new one except recency.
 *
 * So: versions are `draft` until published, published versions are immutable,
 * sends resolve the newest *published* version, and a version declares the
 * variables it needs. Publishing validates against that declaration, with
 * optional preview data, and refuses with the specific problem rather than
 * discovering it in production.
 *
 * This module is shared by the API routes, the dashboard and the send path so
 * the three cannot disagree about what "sendable" means.
 */

export type TemplateStatus = "draft" | "published";

export interface TemplateVariable {
  /** The name as it appears inside `{{ }}` (dots allowed: `user.name`). */
  name: string;
  /** Optional variables may be absent at send time; required ones may not. */
  required: boolean;
}

export interface TemplateContent {
  subject: string | null;
  html: string | null;
  text: string | null;
}

/** The one regex the whole product uses for `{{variable}}`. */
export const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function extractVariables(...bodies: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const body of bodies) {
    if (!body) continue;
    for (const m of body.matchAll(VARIABLE_RE)) found.add(m[1]!);
  }
  return [...found].sort();
}

/**
 * Normalise a caller's declaration. Accepts `["name"]` or
 * `[{name, required}]`; unknown shapes are dropped rather than trusted, because
 * the declaration decides whether a send is allowed.
 */
export function normaliseVariables(input: unknown): TemplateVariable[] {
  if (!Array.isArray(input)) return [];
  const seen = new Map<string, TemplateVariable>();
  for (const entry of input) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (/^[\w.]+$/.test(name)) seen.set(name, { name, required: true });
      continue;
    }
    if (entry && typeof entry === "object") {
      const raw = entry as { name?: unknown; required?: unknown };
      if (typeof raw.name !== "string") continue;
      const name = raw.name.trim();
      if (!/^[\w.]+$/.test(name)) continue;
      seen.set(name, { name, required: raw.required !== false });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface PublishProblem {
  code:
    | "no_subject"
    | "no_body"
    | "undeclared_variable"
    | "missing_preview_variable"
    | "empty_preview_variable";
  message: string;
  variables: string[];
}

/**
 * Everything that must be true before a version may be published.
 *
 * `preview` is optional sample data. Without it we can still check structure and
 * the declaration; with it we can check the thing the customer actually cares
 * about — that this renders with real values — so publishing from the editor
 * passes the editor's preview data.
 */
export function validateForPublish(
  content: TemplateContent,
  declared: TemplateVariable[],
  preview?: Record<string, string>
): PublishProblem[] {
  const problems: PublishProblem[] = [];
  const subject = (content.subject ?? "").trim();
  if (!subject) {
    problems.push({
      code: "no_subject",
      message: "A template needs a subject — a message with an empty subject is treated as spam.",
      variables: [],
    });
  }
  if (!(content.html ?? "").trim() && !(content.text ?? "").trim()) {
    problems.push({
      code: "no_body",
      message: "A template needs HTML or plain text (or both) before it can be published.",
      variables: [],
    });
  }

  const used = extractVariables(content.subject, content.html, content.text);
  const declaredNames = new Set(declared.map((d) => d.name));
  const undeclared = used.filter((name) => !declaredNames.has(name));
  if (undeclared.length > 0) {
    // An undeclared placeholder is not a style question: the sender has no way
    // to know it is expected, so it goes out as literal `{{name}}`.
    problems.push({
      code: "undeclared_variable",
      message:
        `These placeholders are not declared: ${undeclared.join(", ")}. ` +
        "Declare every variable the template uses, so callers know what to pass.",
      variables: undeclared,
    });
  }

  if (preview) {
    const missing = declared
      .filter(
        (d) => d.required && !used.includes(d.name) === false && preview[d.name] === undefined
      )
      .map((d) => d.name);
    if (missing.length > 0) {
      problems.push({
        code: "missing_preview_variable",
        message: `Preview data is missing a value for ${missing.join(", ")}.`,
        variables: missing,
      });
    }
    const empty = used.filter((name) => preview[name] !== undefined && preview[name].trim() === "");
    if (empty.length > 0) {
      problems.push({
        code: "empty_preview_variable",
        message: `Preview data is empty for ${empty.join(", ")} — that is what recipients would see.`,
        variables: empty,
      });
    }
  }

  return problems;
}

export interface RenderResult {
  subject: string;
  html: string | null;
  text: string | null;
  /** Placeholders with no value supplied; a real send refuses when non-empty. */
  missing: string[];
}

/** Substitute `{{name}}` with values. Missing keys are reported, not blanked. */
export function renderTemplate(
  content: TemplateContent,
  variables: Record<string, string> = {}
): RenderResult {
  const missing = new Set<string>();
  const fill = (body: string | null): string | null => {
    if (body === null) return null;
    return body.replace(VARIABLE_RE, (match, key: string) => {
      const value = variables[key];
      if (value === undefined) {
        missing.add(key);
        return match;
      }
      return value;
    });
  };
  return {
    subject: fill(content.subject) ?? "",
    html: fill(content.html),
    text: fill(content.text),
    missing: [...missing].sort(),
  };
}

/**
 * Which version a send should use. Kept as a pure decision so the rule is
 * stated once: the newest **published** version, and never a draft.
 */
export function pickSendableVersion<T extends { status: TemplateStatus; publishedAt: Date | null }>(
  versions: T[]
): T | null {
  const published = versions.filter((v) => v.status === "published");
  if (published.length === 0) return null;
  return published.reduce((newest, candidate) => {
    const a = newest.publishedAt?.getTime() ?? 0;
    const b = candidate.publishedAt?.getTime() ?? 0;
    return b > a ? candidate : newest;
  });
}
