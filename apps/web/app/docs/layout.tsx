import Link from "next/link";
import { Logo } from "../../components/logo";
import { DocsSearch } from "../../components/docs-search";

const SECTIONS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Start",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart: Node.js", href: "/docs/quickstart/nodejs" },
      { label: "Quickstart: Python", href: "/docs/quickstart/python" },
      { label: "Quickstart: Go", href: "/docs/quickstart/go" },
      { label: "Quickstart: PHP", href: "/docs/quickstart/php" },
      { label: "Quickstart: Ruby", href: "/docs/quickstart/ruby" },
      { label: "Quickstart: cURL", href: "/docs/quickstart/curl" },
      { label: "Quickstart: Shell", href: "/docs/quickstart/cli" },
      { label: "Gmail Quickstart", href: "/docs/gmail-quickstart" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Sending", href: "/docs/sending" },
      { label: "SMTP", href: "/docs/smtp" },
      { label: "Domains", href: "/docs/domains" },
      { label: "API Keys", href: "/docs/api-keys" },
      { label: "Webhooks", href: "/docs/webhooks" },
      { label: "Idempotency", href: "/docs/idempotency" },
      { label: "Suppression", href: "/docs/suppression" },
      { label: "Usage & Billing", href: "/docs/usage-billing" },
      { label: "Templates (soon)", href: "/docs/templates" },
      { label: "OTP (soon)", href: "/docs/otp" },
      { label: "Core concepts", href: "/docs/concepts" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Examples", href: "/docs/examples" },
      { label: "Security", href: "/docs/security" },
      { label: "Migrate from Resend", href: "/docs/migrate-resend" },
      { label: "Migrate from Postmark", href: "/docs/migrate-postmark" },
      { label: "API reference", href: "/docs/api-reference" },
      { label: "Deliverability", href: "/docs/deliverability" },
      { label: "Glossary", href: "/resources/glossary" },
    ],
  },
];

const TABS = [
  { label: "Documentation", href: "/docs" },
  { label: "API Reference", href: "/docs/api-reference" },
  { label: "Webhook Events", href: "/docs/webhooks" },
  { label: "Changelog", href: "/changelog" },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <header className="docs-top">
        <div className="wrap docs-top-inner">
          <Link href="/" aria-label="Calder home">
            <Logo />
          </Link>
          <nav className="docs-tabs" aria-label="Documentation sections">
            {TABS.map((t) => (
              <Link key={t.href + t.label} href={t.href}>
                {t.label}
              </Link>
            ))}
          </nav>
          <nav className="docs-top-links" aria-label="Site">
            <DocsSearch />
            <Link href="/pricing">Pricing</Link>
            <Link href="/status">Status</Link>
            <Link href="/waitlist" className="btn btn-primary btn-sm">
              Get an API key
            </Link>
          </nav>
        </div>
      </header>
      <div className="wrap docs-body">
        <aside className="docs-side">
          <nav aria-label="Documentation">
            {SECTIONS.map((s) => (
              <div key={s.title} className="docs-side-group">
                <h4>{s.title}</h4>
                <ul>
                  {s.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href}>{l.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        <article className="docs-main">{children}</article>
      </div>
    </div>
  );
}
