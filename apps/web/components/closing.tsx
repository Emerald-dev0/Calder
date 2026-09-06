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
              <g transform="translate(94,94) scale(3.6)">
                <path
                  d="M10 55 L26 9 L42 55"
                  fill="none"
                  stroke="#F5F4EF"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M17 41 H24 L27 35 L31 45 L34 39 H41"
                  fill="none"
                  stroke="#F5F4EF"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="45.5" cy="41" r="4.5" fill="#3B82F6" />
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
              <a className="btn btn-paper" href="#top">
                Create your project{" "}
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </a>
              <a className="btn btn-outline-paper" href="#developers">
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
          Avenor
        </div>
        <div className="footer-bottom">
          <span>© 2026 Avenor — communication infrastructure that gets out of your way.</span>
          <span style={{ display: "inline-flex", gap: "1rem" }}>
            <a href="/legal/privacy">Privacy</a>
            <a href="/legal/terms">Terms</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
