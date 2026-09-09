"use client";

import * as React from "react";
import { Logo } from "./logo";

const links = [
 { label: "Pipeline", href: "/#pipeline" },
 { label: "Developers", href: "/#developers" },
 { label: "Product", href: "/#product" },
 { label: "Pricing", href: "/#pricing" },
 { label: "Docs", href: "/docs" },
 { label: "Waitlist", href: "/waitlist" },
];

export function Navigation() {
 const [open, setOpen] = React.useState(false);

 return (
 <header className="nav">
 <div className="nav-inner">
 <a href="/" aria-label="Calder home">
 <Logo />
 </a>
 <nav className={`nav-links${open ? "open" : ""}`} aria-label="Primary">
 {links.map((l) => (
 <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
 {l.label}
 </a>
 ))}
 </nav>
 <div className="nav-cta">
 <a className="btn btn-ghost btn-sm" href="/docs">
 Read the docs
 </a>
 <a className="btn btn-primary btn-sm" href="/waitlist">
 Join the waitlist{" "}
 <span className="arrow" aria-hidden="true">
 →
 </span>
 </a>
 <button
 className="nav-toggle"
 aria-expanded={open}
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
