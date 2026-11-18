/**
 * A small, closed formatting vocabulary for operator-written email.
 *
 * An announcement typed into the console used to be plain text: no bold, no
 * lists, no links (the only link was the CTA button). That is not enough to
 * write a pricing change — a plan table or even a two-item list came out as
 * prose.
 *
 * The tempting answer is a rich-text editor producing HTML, and a sanitiser to
 * clean it up. This is deliberately not that: sanitising user HTML is a
 * moving target, and a mailshot has no undo. Instead the composer accepts a
 * *tiny* markdown subset, and this module is the only thing that turns it into
 * markup:
 *
 *   **bold**              → strong
 *   _italic_              → em
 *   - item / * item       → bullet list (consecutive lines)
 *   1. item               → numbered list
 *   [label](https://…)    → link, http(s) only
 *   blank line            → new paragraph
 *   single newline        → line break
 *
 * Every character of the author's text is escaped exactly once, and the only
 * tags in the output are the ones written here. A `javascript:` URL is not a
 * link — it stays visible text, because a silently dropped link is worse than
 * one the author can see was ignored. Anything unrecognised is left alone.
 *
 * Each block is returned twice: as HTML for the inbox, and as plain text for
 * the multipart alternative, so both halves of the message say the same thing.
 */

import {
  escapeHtml,
  paragraphHtml,
  richEm,
  richLink,
  richList,
  richStrong,
  safeUrl,
} from "./blocks.js";

export interface RichText {
  /** One entry per paragraph or list. */
  html: string[];
  /** The same blocks as plain text, for the `text/plain` alternative. */
  text: string[];
}

interface ListItem {
  content: string;
  ordered: boolean;
}

const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

/**
 * Render one line of text: bold, italic and links, everything else literal.
 *
 * A hand-written scanner rather than a regex over the escaped string, because
 * the escaping has to happen *inside* the token, not around it: a name
 * containing `<` must be escaped and still be allowed to be bold.
 */
function renderInline(raw: string): string {
  let out = "";
  let index = 0;

  while (index < raw.length) {
    const rest = raw.slice(index);

    const bold = /^\*\*([\s\S]+?)\*\*/.exec(rest);
    if (bold) {
      out += richStrong(renderInline(bold[1]!));
      index += bold[0].length;
      continue;
    }

    const em = /^_([^_\n]+)_/.exec(rest);
    if (em) {
      out += richEm(renderInline(em[1]!));
      index += em[0].length;
      continue;
    }

    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeUrl(link[2]);
      // An unusable URL is shown, not swallowed: the author needs to see that
      // what they typed did not become a link.
      out += href ? richLink(href, renderInline(link[1]!)) : escapeHtml(link[0]);
      index += link[0].length;
      continue;
    }

    out += escapeHtml(raw[index]!);
    index += 1;
  }

  return out;
}

/**
 * Strip the formatting characters, keeping the words — for preheaders and text.
 *
 * `keepUrls` is for the `text/plain` alternative: a reader there cannot click,
 * so the address has to be written out. A preheader takes the bare label, since
 * it is a one-line summary and a URL in it reads like a bug.
 */
export function plainFromRich(source: string, options: { keepUrls?: boolean } = {}): string {
  return source
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, options.keepUrls ? "$1 ($2)" : "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderRichText(source: string): RichText {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  const text: string[] = [];

  let paragraph: string[] = [];
  let list: ListItem[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(paragraphHtml(paragraph.map(renderInline).join("<br />")));
    text.push(paragraph.map((line) => plainFromRich(line, { keepUrls: true })).join("\n"));
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const ordered = list[0]!.ordered;
    html.push(
      richList(
        list.map((item) => renderInline(item.content)),
        ordered
      )
    );
    text.push(
      list
        .map(
          (item, position) =>
            (ordered ? `${position + 1}. ` : "• ") + plainFromRich(item.content, { keepUrls: true })
        )
        .join("\n")
    );
    list = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const bullet = BULLET.exec(line.trim());
    const numbered = NUMBERED.exec(line.trim());
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      // A list only continues while its kind does not change.
      if (list.length > 0 && list[0]!.ordered !== ordered) flushList();
      flushParagraph();
      list.push({ content: (bullet?.[1] ?? numbered?.[1] ?? "").trim(), ordered });
      continue;
    }

    if (list.length > 0) flushList();
    paragraph.push(line);
  }

  flushAll();

  return { html, text };
}
