"use client";

import { useRef, useState } from "react";

/**
 * The body box for a company email, with the formatting an operator expects.
 *
 * The body used to be a plain `<textarea>`: paragraphs, line breaks, and one
 * CTA button. That is not enough to write a pricing change ("**Growth** is now
 * $8"), a changelog (three bullets), or a sentence that points at a help page
 * mid-line.
 *
 * The alternative — a rich-text editor producing HTML — would mean sanitising
 * operator HTML at send time, on a mailshot that cannot be recalled. So the
 * textarea stays the source of truth and holds a deliberately tiny markdown
 * subset; these buttons only insert the markers at the cursor. The server
 * renders that subset in `rich-text.ts`, which escapes every character before
 * it adds any tag of its own.
 *
 * The buttons are pure convenience: with JS off the textarea accepts the same
 * markers, and the form posts the same field name. Nothing about sending
 * depends on this component running.
 */

export interface BodyEditorProps {
  name: string;
  defaultValue: string;
  minLength?: number;
  maxLength?: number;
}

/** Leading list marker, so a second click renumbers instead of stacking. */
const LIST_PREFIX = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function BodyEditor({ name, defaultValue, minLength, maxLength }: BodyEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [length, setLength] = useState(defaultValue.length);

  /**
   * Replace a slice of the textarea and leave the caret where it belongs.
   *
   * `setRangeText` rather than assigning `.value`: an operator who clicks the
   * wrong button must be able to undo, and a direct assignment throws away the
   * browser's undo history.
   */
  const replace = (start: number, end: number, text: string, select: [number, number]) => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    element.setRangeText(text, start, end, "end");
    element.setSelectionRange(select[0], select[1]);
    setLength(element.value.length);
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const element = ref.current;
    if (!element) return;
    const { selectionStart: start, selectionEnd: end, value } = element;
    const chosen = value.slice(start, end);
    const inner = chosen || placeholder;
    const text = before + inner + after;
    // Leave the wrapped words selected: a second click then unwraps the same
    // range, and with no selection the placeholder is typed over directly.
    const innerStart = start + before.length;
    replace(start, end, text, [innerStart, innerStart + inner.length]);
  };

  const prefixLines = (ordered: boolean) => {
    const element = ref.current;
    if (!element) return;
    const { value } = element;
    const blockStart = value.lastIndexOf("\n", element.selectionStart - 1) + 1;
    const lineEnd = value.indexOf("\n", element.selectionEnd);
    const blockEnd = lineEnd === -1 ? value.length : lineEnd;

    let position = 0;
    const text = value
      .slice(blockStart, blockEnd)
      .split("\n")
      .map((line) => {
        const bare = line.replace(LIST_PREFIX, "");
        if (bare.trim() === "") return bare;
        position += 1;
        return ordered ? `${position}. ${bare}` : `- ${bare}`;
      })
      .join("\n");

    replace(blockStart, blockEnd, text, [blockStart, blockStart + text.length]);
  };

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
      <label htmlFor="company-email-body">Body</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="cp-btn"
          onClick={() => wrapSelection("**", "**", "bold text")}
          aria-label="Bold"
          title="Bold — **text**"
          style={{ fontWeight: 700 }}
        >
          B
        </button>
        <button
          type="button"
          className="cp-btn"
          onClick={() => wrapSelection("_", "_", "italic text")}
          aria-label="Italic"
          title="Italic — _text_"
          style={{ fontStyle: "italic" }}
        >
          I
        </button>
        <button
          type="button"
          className="cp-btn"
          onClick={() => prefixLines(false)}
          title="Bulleted list — each line starts with -"
        >
          Bullets
        </button>
        <button
          type="button"
          className="cp-btn"
          onClick={() => prefixLines(true)}
          title="Numbered list — each line starts with 1."
        >
          Numbers
        </button>
        <button
          type="button"
          className="cp-btn"
          onClick={() => wrapSelection("[", "](https://)", "link text")}
          title="Link — [label](https://…)"
        >
          Link
        </button>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11.5,
            fontWeight: 500,
            color: "var(--cp-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {length}
          {maxLength ? ` / ${maxLength}` : ""}
        </span>
      </div>
      <textarea
        id="company-email-body"
        ref={ref}
        name={name}
        className="cp-input"
        rows={8}
        required
        minLength={minLength}
        maxLength={maxLength}
        defaultValue={defaultValue}
        onChange={(event) => setLength(event.target.value.length)}
        aria-describedby="company-email-body-help"
      />
      <p
        id="company-email-body-help"
        style={{
          fontSize: 12,
          fontWeight: 400,
          color: "var(--cp-muted)",
          margin: 0,
          lineHeight: 1.55,
        }}
      >
        Formatting: <code>**bold**</code>, <code>_italic_</code>, a line starting with{" "}
        <code>-</code> or <code>1.</code> for a list, and <code>[label](https://…)</code> for a
        link. Only http(s) links become links — anything else is left as visible text. Blank lines
        separate paragraphs.
      </p>
    </div>
  );
}
