"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

interface Entry {
  title: string;
  href: string;
  section: string;
  keywords: string;
}

const INDEX: Entry[] = [
  { title: "Documentation", href: "/docs", section: "Start", keywords: "home index start" },
  {
    title: "Quickstart: Node.js",
    href: "/docs/quickstart/nodejs",
    section: "Quickstart",
    keywords: "node typescript javascript fetch first send",
  },
  {
    title: "Quickstart: Python",
    href: "/docs/quickstart/python",
    section: "Quickstart",
    keywords: "python requests first send",
  },
  {
    title: "Quickstart: Go",
    href: "/docs/quickstart/go",
    section: "Quickstart",
    keywords: "go golang net http first send",
  },
  {
    title: "Quickstart: PHP",
    href: "/docs/quickstart/php",
    section: "Quickstart",
    keywords: "php curl first send",
  },
  {
    title: "Quickstart: Ruby",
    href: "/docs/quickstart/ruby",
    section: "Quickstart",
    keywords: "ruby net http first send",
  },
  {
    title: "Quickstart: cURL",
    href: "/docs/quickstart/curl",
    section: "Quickstart",
    keywords: "curl shell terminal first send",
  },
  {
    title: "Quickstart: Shell scripting",
    href: "/docs/quickstart/cli",
    section: "Quickstart",
    keywords: "cli shell bash jq scripting automation",
  },
  {
    title: "Gmail Quickstart",
    href: "/docs/gmail-quickstart",
    section: "Quickstart",
    keywords: "gmail no domain beginner oauth start sending graduate",
  },
  {
    title: "Sending",
    href: "/docs/sending",
    section: "Learn",
    keywords: "send email api request response 202",
  },
  {
    title: "SMTP",
    href: "/docs/smtp",
    section: "Learn",
    keywords: "smtp nodemailer smtplib credentials port 587 starttls",
  },
  {
    title: "Domains",
    href: "/docs/domains",
    section: "Learn",
    keywords: "domain dns spf dkim dmarc verify",
  },
  {
    title: "API Keys",
    href: "/docs/api-keys",
    section: "Learn",
    keywords: "keys test live rotate revoke",
  },
  {
    title: "Webhooks",
    href: "/docs/webhooks",
    section: "Learn",
    keywords: "events signing verify retry replay",
  },
  {
    title: "Idempotency",
    href: "/docs/idempotency",
    section: "Learn",
    keywords: "idempotency key retry duplicate exactly once",
  },
  {
    title: "Suppression",
    href: "/docs/suppression",
    section: "Learn",
    keywords: "suppression bounce complaint blocked unsubscribe",
  },
  {
    title: "Usage & Billing",
    href: "/docs/usage-billing",
    section: "Learn",
    keywords: "usage billing plans quota naira ngn usd invoice",
  },
  {
    title: "Templates (soon)",
    href: "/docs/templates",
    section: "Learn",
    keywords: "templates variables",
  },
  {
    title: "OTP (soon)",
    href: "/docs/otp",
    section: "Learn",
    keywords: "otp one-time passcode verification",
  },
  {
    title: "Core concepts",
    href: "/docs/concepts",
    section: "Learn",
    keywords: "lifecycle async concepts overview",
  },
  {
    title: "API reference",
    href: "/docs/api-reference",
    section: "Reference",
    keywords: "endpoints errors rate limits reference",
  },
  {
    title: "Deliverability",
    href: "/docs/deliverability",
    section: "Guides",
    keywords: "deliverability inbox spam reputation warmup",
  },
  {
    title: "Examples",
    href: "/docs/examples",
    section: "Resources",
    keywords: "examples nextjs express hono framework",
  },
  {
    title: "Security",
    href: "/docs/security",
    section: "Resources",
    keywords: "security keys secrets signatures",
  },
  {
    title: "Switch to Calder",
    href: "/migrate",
    section: "Resources",
    keywords: "migrate switch move provider zero downtime",
  },
  {
    title: "Changelog",
    href: "/changelog",
    section: "Resources",
    keywords: "changelog releases new",
  },
];

/**
 * Client-side docs search (Cmd+K). Static index, substring match over
 * title + keywords — no dependency, transform/opacity only, Esc to close.
 */
export function DocsSearch() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return INDEX.slice(0, 8);
    return INDEX.filter((e) =>
      `${e.title} ${e.keywords} ${e.section}`.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button className="docs-search-btn" onClick={() => setOpen(true)} aria-label="Search docs">
        <span>Search docs</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="docs-search-overlay" onClick={() => setOpen(false)}>
          <div
            className="docs-search-modal"
            role="dialog"
            aria-label="Search documentation"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                }
                if (e.key === "Enter" && results[active]) go(results[active].href);
              }}
              placeholder="Search guides, references, concepts…"
              aria-label="Search documentation"
            />
            <ul>
              {results.map((r, i) => (
                <li key={r.href}>
                  <button
                    className={i === active ? "active" : ""}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                  >
                    <span className="docs-search-section">{r.section}</span>
                    <span>{r.title}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="docs-search-empty">No matches — try “send” or “webhook”.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
