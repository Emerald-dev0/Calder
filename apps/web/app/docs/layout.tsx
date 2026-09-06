import Link from "next/link";
import { Logo } from "../../components/logo";

const SECTIONS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Start",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Core concepts", href: "/docs/concepts" },
    ],
  },
  {
    title: "Guides",
    links: [
      { label: "API reference", href: "/docs/api-reference" },
      { label: "Webhooks", href: "/docs/webhooks" },
      { label: "Deliverability", href: "/docs/deliverability" },
    ],
  },
  {
    title: "Elsewhere",
    links: [
      { label: "Migrate from Resend", href: "/migrate" },
      { label: "Status", href: "/status" },
      { label: "Support", href: "/support" },
    ],
  },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <header className="docs-top">
        <div className="wrap docs-top-inner">
          <Link href="/" aria-label="Avenor home">
            <Logo />
          </Link>
          <nav className="docs-top-links" aria-label="Site">
            <Link href="/pricing">Pricing</Link>
            <Link href="/status">Status</Link>
            <Link href="/#start" className="btn btn-primary btn-sm">
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
