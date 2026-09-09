import { Reveal } from "./reveal";
import { Logo } from "./logo";

export function FinalCta() {
  return (
    <section className="section" id="start" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <div className="final-cta">
            <svg
              className="signal-bg"
              width="420"
              height="420"
              viewBox="0 0 420 420"
              aria-hidden="true"
            >
              <g transform="translate(103,143) scale(1.95)" fill="#F5F4EF">
                <circle cx="18" cy="50" r="9" />
                <path d="M31 18C34 12 39 9 46 9h7c5 0 8 3 11 9l27 52H72L51 31c-2-4-5-6-9-6h-4c-3 0-5 2-7 6l-5 9-9-9z" />
              </g>
              <circle
                cx="210"
                cy="210"
                r="150"
                fill="none"
                stroke="#F5F4EF"
                strokeWidth="1.5"
                strokeDasharray="4 10"
              />
              <circle
                cx="210"
                cy="210"
                r="195"
                fill="none"
                stroke="#F5F4EF"
                strokeWidth="1.5"
                strokeDasharray="4 14"
              />
            </svg>
            <p className="eyebrow" style={{ color: "#8FB0FF" }}>
              Get started
            </p>
            <h2>
              Go get your first <em>delivery.</em>
            </h2>
            <p>
              Not your first signup form, not your first dashboard tour — your first email, landing
              in an inbox, with the webhook to prove it. Test keys are free and can&rsquo;t hurt
              anything. The only thing standing between you and that little{" "}
              <span className="mono">delivered</span> tag is one POST request.
            </p>
            <div className="final-ctas">
              <a className="btn btn-paper" href="/waitlist">
                Join the waitlist{" "}
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </a>
              <a className="btn btn-outline-paper" href="/docs/quickstart">
                Read the quickstart
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string }> }> = [
  {
    title: "Product",
    links: [
      { label: "Developers", href: "/developers" },
      { label: "Templates", href: "/templates" },
      { label: "Webhooks", href: "/webhooks" },
      { label: "Domains", href: "/domains" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "API reference", href: "/docs/api-reference" },
      { label: "Migrate from Resend", href: "/migrate" },
      { label: "Resend alternative", href: "/alternatives/resend" },
      { label: "Glossary", href: "/resources/glossary" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Changelog", href: "/changelog" },
      { label: "Brand", href: "/brand" },
      { label: "Security", href: "/security" },
      { label: "Support", href: "/support" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="caption" style={{ marginTop: "1rem", maxWidth: "22rem" }}>
              Developer-first communication infrastructure. Transactional email is the first
              primitive — OTP, verification, receipts, and notifications all travel the same
              observable path.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h4>{col.title}</h4>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="footer-giant" aria-hidden="true" data-parallax="0.05">
          Calder
        </div>
        <div className="footer-bottom">
          <span>© 2026 Calder — communication infrastructure that gets out of your way.</span>
          <span style={{ display: "inline-flex", gap: "1rem" }}>
            <a href="/legal/privacy">Privacy</a>
            <a href="/legal/terms">Terms</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
