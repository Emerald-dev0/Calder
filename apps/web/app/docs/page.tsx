import type { Metadata } from "next";
import Link from "next/link";
import { pageMeta } from "../../lib/seo";
import { SIGNUP_URL } from "../../lib/site";

export const metadata: Metadata = pageMeta({
  title: "Documentation",
  description: "Guides and references for the Calder transactional email API.",
  path: "/docs",
});

const QUICKSTARTS = [
  { icon: "TS", title: "Node.js", desc: "fetch in minutes.", href: "/docs/quickstart/nodejs" },
  { icon: "PY", title: "Python", desc: "requests, same shape.", href: "/docs/quickstart/python" },
  { icon: "GO", title: "Go", desc: "net/http, no deps.", href: "/docs/quickstart/go" },
  { icon: "PHP", title: "PHP", desc: "cURL extension.", href: "/docs/quickstart/php" },
  { icon: "RB", title: "Ruby", desc: "net/http stdlib.", href: "/docs/quickstart/ruby" },
  { icon: "$_", title: "cURL", desc: "Raw HTTP.", href: "/docs/quickstart/curl" },
  { icon: "SH", title: "Shell", desc: "Script the API.", href: "/docs/quickstart/cli" },
] as const;

const EXPLORE = [
  { icon: "✉", title: "Emails", desc: "Send and track.", href: "/docs/sending" },
  { icon: "✓", title: "Domains", desc: "Verify and monitor.", href: "/docs/domains" },
  { icon: "↯", title: "Webhooks", desc: "Events, signed.", href: "/docs/webhooks" },
  { icon: "◈", title: "API Keys", desc: "Test vs live.", href: "/docs/api-keys" },
  { icon: "◔", title: "Usage & Billing", desc: "Metered, NGN/USD.", href: "/docs/usage-billing" },
] as const;

export default function DocsIndex() {
  return (
    <>
      <h1>Documentation</h1>
      <p className="docs-lede">
        Calder sends email for applications: verification codes, password resets, receipts and
        alerts through one API or an SMTP relay, with a record of what happened to every message.
      </p>

      <h2>Before you start</h2>
      <ol className="docs-prereqs">
        <li>
          <span>
            <b>An API key.</b> <Link href={SIGNUP_URL}>Create an account</Link> and the dashboard
            hands you one. Test keys run the whole pipeline without delivering anything, so you can
            build before you buy a domain.
          </span>
        </li>
        <li>
          <span>
            <b>A verified sending domain, or skip it.</b> Test keys work with zero DNS setup; add a
            real domain under <Link href="/docs/domains">Domains</Link> whenever you&rsquo;re ready
            to go live.
          </span>
        </li>
      </ol>

      <h2>Quickstart</h2>
      <div className="docs-cards">
        {QUICKSTARTS.map((c) => (
          <Link key={c.href} href={c.href} className="docs-card">
            <span className="docs-card-icon">{c.icon}</span>
            <b>{c.title}</b>
            <span>{c.desc}</span>
          </Link>
        ))}
      </div>

      <h2>Explore</h2>
      <div className="docs-cards">
        {EXPLORE.map((c) => (
          <Link key={c.href} href={c.href} className="docs-card">
            <span className="docs-card-icon">{c.icon}</span>
            <b>{c.title}</b>
            <span>{c.desc}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
