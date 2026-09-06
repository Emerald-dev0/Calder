"use client";

import * as React from "react";

interface CodeBlockProps {
  title: string;
  language?: string;
  children: React.ReactNode;
  copyText?: string;
}

/** Dark code panel with copy interaction. */
export function CodeBlock({ title, children, copyText }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      // clipboard unavailable — still show feedback
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{title}</span>
        {copyText && (
          <button className="copy-btn" onClick={copy} aria-live="polite">
            {copied ? "Copied ✓" : "Copy"}
          </button>
        )}
      </div>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}
