"use client";

import * as React from "react";
import { Logo } from "./logo";
import { SIGNUP_URL, LOGIN_URL } from "../lib/site";

const links = [
  { label: "Product", href: "/#streams" },
  { label: "Pricing", href: "/pricing" },
  { label: "Developers", href: "/developers" },
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "/changelog" },
];

export function Navigation() {
  const [open, setOpen] = React.useState(false);

  // Close on Escape, click outside, and when viewport grows past the mobile
  // breakpoint (must match the CSS breakpoint at 820px).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 821px)");
    const onChange = () => setOpen(false);
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const nav = document.getElementById("primary-nav");
      const toggle = document.querySelector(".nav-toggle");
      if (nav?.contains(target) || toggle?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    // Delay to avoid closing immediately on the same tap that opened it.
    window.setTimeout(() => document.addEventListener("click", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <header className="nav">
      <div className="nav-inner">
        <a href="/" aria-label="Calder home">
          <Logo />
        </a>
        <nav id="primary-nav" className={`nav-links${open ? "open" : ""}`} aria-label="Primary">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav-cta">
          <a className="btn btn-primary btn-sm" href="/waitlist">
            Start free{" "}
            <span className="arrow" aria-hidden="true">
              &rarr;
            </span>
          </a>
          <button
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="primary-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              {open ? (
                <path
                  d="M3 3l12 12M15 3L3 15"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 4.5h14M2 9h14M2 13.5h14"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
