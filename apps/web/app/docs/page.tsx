import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation — Avenor",
  description: "Guides and references for the Avenor email infrastructure API.",
};

const CARDS = [
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    desc: "First delivered email in about five minutes.",
  },
  {
    href: "/docs/concepts",
    title: "Core concepts",
    desc: "Lifecycle, idempotency, queues, and events.",
  },
  {
    href: "/docs/api-reference",
    title: "API reference",
    desc: "Endpoints, auth, errors, and rate limits.",
  },
  { href: "/docs/webhooks", title: "Webhooks", desc: "Receiving and verifying event deliveries." },
  {
    href: "/docs/deliverability",
    title: "Deliverability",
    desc: "Domains, authentication, and reputation.",
  },
  { href: "/migrate", title: "Migrate from Resend", desc: "Move sending over in an afternoon." },
] as const;

export default function DocsIndex() {
  return (
    <>
      <h1>Documentation</h1>
      <p className="docs-lede">
        Everything you need to send your first email and understand your hundredth thousand. Start
        with the quickstart; come back for the concepts when something surprises you.
      </p>
      <div style={{ display: "grid", gap: "0.8rem", marginTop: "2rem" }}>
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              textDecoration: "none",
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "1.1rem 1.3rem",
              display: "block",
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--ink)", fontSize: "1.02rem" }}>
              {c.title}
            </span>
            <span
              style={{ display: "block", color: "var(--muted)", fontSize: "0.9rem", marginTop: 4 }}
            >
              {c.desc}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
