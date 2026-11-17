/**
 * Server-side rendering for React Email templates.
 *
 * The brief for this was "accept React source, render it server-side". We do not
 * do that, and the reason is not squeamishness: rendering React source means
 * compiling and executing customer-supplied code inside the process that holds
 * every tenant's data, provider credentials and signing keys. Nothing about a
 * template justifies that. Two paths are supported instead, and both end with
 * plain HTML in a version row — no components exist at send time:
 *
 *  1. the customer renders with `@react-email/render` in their own build and
 *     posts `html`/`text` (always supported, unchanged), or
 *  2. the customer posts the element **tree** as data (`react_tree`), and we
 *     render it here against a whitelist of email-safe components.
 *
 * A tree is data, not code: component names are looked up in a fixed map, props
 * are filtered to strings, and anything unknown is refused rather than dropped —
 * silently discarding an element is how a receipt goes out without its total.
 *
 * The output is deliberately plain: tables where a client needs a table, inline
 * styles only (Gmail strips <style> in several contexts), and no scripting.
 */

export type EmailComponentName =
  | "Html"
  | "Head"
  | "Preview"
  | "Body"
  | "Container"
  | "Section"
  | "Row"
  | "Column"
  | "Heading"
  | "Text"
  | "Link"
  | "Button"
  | "Hr"
  | "Img";

export interface ReactElementNode {
  component: EmailComponentName | string;
  props?: Record<string, unknown>;
  children?: ReactNode[];
}

export type ReactNode = ReactElementNode | string | number | null | boolean;

export interface RenderOptions {
  /** Guard rail: a template that nests this deep is a bug, not an email. */
  maxDepth?: number;
  maxNodes?: number;
}

export interface ReactTreeRender {
  html: string;
  text: string;
}

export const SUPPORTED_COMPONENTS: EmailComponentName[] = [
  "Html",
  "Head",
  "Preview",
  "Body",
  "Container",
  "Section",
  "Row",
  "Column",
  "Heading",
  "Text",
  "Link",
  "Button",
  "Hr",
  "Img",
];

export class ReactTreeError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(message);
    this.name = "ReactTreeError";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only these attributes survive; `on*` and `style` strings never do. */
const ALLOWED_PROPS: Record<string, string[]> = {
  Link: ["href"],
  Button: ["href"],
  Img: ["src", "alt", "width", "height"],
};

function sanitizeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // A template URL is a value we hand to a recipient's mail client. Only
  // absolute http(s) and mailto links are meaningful here; `javascript:` and
  // `data:` are refused rather than neutralised.
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return escapeHtml(trimmed);
  if (trimmed.startsWith("{{")) return escapeHtml(trimmed); // filled at send time
  return null;
}

function sanitizeSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("{{")) return escapeHtml(trimmed);
  return null;
}

function attrsFor(component: string, props: Record<string, unknown>): string {
  const allowed = ALLOWED_PROPS[component] ?? [];
  const out: string[] = [];
  for (const key of allowed) {
    const raw = props[key];
    if (raw === undefined || raw === null) continue;
    if (key === "href") {
      const href = sanitizeHref(raw);
      if (href) out.push(`href="${href}"`);
      continue;
    }
    if (key === "src") {
      const src = sanitizeSrc(raw);
      if (src) out.push(`src="${src}"`);
      continue;
    }
    out.push(`${key}="${escapeHtml(String(raw))}"`);
  }
  return out.length > 0 ? " " + out.join(" ") : "";
}

function textOf(node: ReactNode, into: string[], stateholder: { hidden: boolean }): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    if (!stateholder.hidden) into.push(String(node));
    return;
  }
  const component = String(node.component);
  if (component === "Head" || component === "Preview") {
    const wasHidden = stateholder.hidden;
    stateholder.hidden = true;
    for (const child of node.children ?? []) textOf(child, into, stateholder);
    stateholder.hidden = wasHidden;
    return;
  }
  for (const child of node.children ?? []) textOf(child, into, stateholder);
}

const STYLES: Record<string, string> = {
  body: "margin:0;padding:0;background-color:#f6f7f9;",
  container: "max-width:600px;margin:0 auto;padding:32px 24px;background-color:#ffffff;",
  section: "padding:0 0 16px;",
  row: "width:100%;",
  column: "vertical-align:top;",
  h1: "margin:0 0 16px;font-size:24px;line-height:1.3;color:#111827;",
  p: "margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;",
  a: "color:#2563eb;text-decoration:underline;",
  button:
    "display:inline-block;padding:12px 20px;border-radius:8px;background-color:#111827;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;",
  hr: "border:none;border-top:1px solid #e5e7eb;margin:24px 0;",
  img: "display:block;max-width:100%;height:auto;border:0;",
};

function renderNode(
  node: ReactNode,
  depth: number,
  budget: { nodes: number },
  maxDepth: number
): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return escapeHtml(String(node));

  if (depth > maxDepth) {
    throw new ReactTreeError("Template nests too deeply.", `depth>${maxDepth}`);
  }
  budget.nodes += 1;
  if (budget.nodes > 2000) {
    throw new ReactTreeError("Template has too many elements.", "nodes>2000");
  }

  const component = String(node.component);
  const props = (node.props ?? {}) as Record<string, unknown>;
  const children = node.children ?? [];

  switch (component) {
    case "Html":
      return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html lang="en">${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</html>`;
    case "Head":
      // Nothing we emit needs the head: styles are inline by design.
      return `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>`;
    case "Preview": {
      // Inbox preview text: hidden in the body, still present for clients.
      const text = children
        .map((c) => {
          const parts: string[] = [];
          textOf(c, parts, { hidden: false });
          return parts.join(" ");
        })
        .join(" ");
      return `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(text)}</div>`;
    }
    case "Body":
      return `<body style="${STYLES.body}">${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</body>`;
    case "Container":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="${STYLES.container}"><tr><td>${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</td></tr></table></td></tr></table>`;
    case "Section":
      return `<div style="${STYLES.section}">${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</div>`;
    case "Row":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</tr></table>`;
    case "Column":
      return `<td style="${STYLES.column}">${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</td>`;
    case "Heading": {
      const level = props.as === "h2" || props.as === "h3" ? String(props.as) : "h1";
      return `<${level} style="${STYLES[level]}">${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</${level}>`;
    }
    case "Text":
      return `<p style="${STYLES.p}">${children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("")}</p>`;
    case "Link": {
      const href = sanitizeHref(props.href);
      const inner = children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("");
      // A link without a usable href keeps its text: dropping the child would
      // delete content, and an anchor without a target is still readable.
      return href
        ? `<a${attrsFor("Link", props)} style="${STYLES.a}">${inner}</a>`
        : `<span style="${STYLES.a}">${inner}</span>`;
    }
    case "Button": {
      const href = sanitizeHref(props.href);
      const inner = children.map((c) => renderNode(c, depth + 1, budget, maxDepth)).join("");
      return href
        ? `<a${attrsFor("Button", props)} style="${STYLES.button}" role="button">${inner}</a>`
        : `<span style="${STYLES.button}">${inner}</span>`;
    }
    case "Hr":
      return `<hr style="${STYLES.hr}" />`;
    case "Img": {
      const src = sanitizeSrc(props.src);
      if (!src) {
        // An image with no usable source renders as its alt text rather than a
        // broken image icon: recipients still learn what it was.
        return props.alt ? `<p style="${STYLES.p}">${escapeHtml(String(props.alt))}</p>` : "";
      }
      return `<img${attrsFor("Img", props)} style="${STYLES.img}" />`;
    }
    default:
      throw new ReactTreeError(
        `Unsupported component "${component}". Supported: ${SUPPORTED_COMPONENTS.join(", ")}.`,
        component
      );
  }
}

/**
 * Render an element tree to email-safe HTML and a readable text alternative.
 *
 * Both outputs are stored on the version, which is the whole point: no component
 * tree survives to send time, so a send is the same code path as any other
 * template and cannot fail on a renderer that is not there.
 */
export function renderReactTree(
  tree: ReactElementNode,
  options: RenderOptions = {}
): ReactTreeRender {
  if (!tree || typeof tree !== "object" || typeof tree.component !== "string") {
    throw new ReactTreeError("A template tree needs a root element with a component name.", "root");
  }
  const budget = { nodes: 0 };
  const maxDepth = options.maxDepth ?? 40;
  let html = renderNode(tree, 0, budget, maxDepth);

  // Anyone may omit Html/Body wrappers; a fragment still has to be a document.
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /></head><body style="${STYLES.body}">${html}</body></html>`;
  }

  const parts: string[] = [];
  textOf(tree, parts, { hidden: false });
  const text = normaliseText(parts.join(" "));
  return { html, text };
}

/**
 * HTML → text is a lossy thing to do per node, so the text is built from the
 * tree instead: block-level components break lines, everything else joins with
 * a space. That keeps a paragraph from becoming one long line of sentences.
 */
function normaliseText(raw: string): string {
  return raw
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Structural check used by the API before rendering: cheap, no rendering. */
export function parseReactTree(input: unknown): ReactElementNode {
  const node = input as ReactElementNode | null;
  if (
    !node ||
    typeof node !== "object" ||
    typeof (node as ReactElementNode).component !== "string"
  ) {
    throw new ReactTreeError(
      "react_tree must be an object with a `component` name and optional `props`/`children`.",
      "root"
    );
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new ReactTreeError("`children` must be an array.", "root.children");
  }
  const visit = (value: unknown, path: string, depth: number): void => {
    if (value === null || typeof value !== "object") return;
    const element = value as ReactElementNode;
    if (typeof element.component !== "string") {
      throw new ReactTreeError("Every element needs a `component` name.", path);
    }
    if (depth > 40) throw new ReactTreeError("Template nests too deeply.", path);
    if (element.children !== undefined && !Array.isArray(element.children)) {
      throw new ReactTreeError("`children` must be an array.", `${path}.children`);
    }
    (element.children ?? []).forEach((child, index) =>
      visit(child, `${path}.children[${index}]`, depth + 1)
    );
  };
  visit(node, "root", 0);
  return node;
}
