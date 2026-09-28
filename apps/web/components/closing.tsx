import { Reveal } from "./reveal";
import { Logo } from "./logo";
import { SIGNUP_URL, SUPPORT_EMAIL } from "../lib/site";

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
              <g transform="translate(103, 143) scale(1.95)" fill="#F5F4EF">
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
              Start building
            </p>
            <h2>
              Your application has <em>enough to worry about.</em>
            </h2>
            <p>
              Let Calder handle the communication infrastructure. Start with 5,000 emails free,
              connect your application in minutes, and know what happens after you hit
              <strong> Send</strong>.
            </p>
            <div className="final-ctas">
              <a className="btn btn-paper" href="/waitlist">
                Create your account{" "}
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
      { label: "Transactional email", href: "/#streams" },
      { label: "Marketing email", href: "/waitlist" },
      { label: "Domains", href: "/domains" },
      { label: "Webhooks", href: "/webhooks" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "API reference", href: "/docs/api-reference" },
      { label: "SMTP setup", href: "/docs/smtp" },
      { label: "Switch to Calder", href: "/migrate" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Changelog", href: "/changelog" },
      { label: "Blog", href: "/blog" },
      { label: "Security", href: "/security" },
      { label: "Brand", href: "/brand" },
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
            <p
              className="caption"
              style={{
                marginTop: "1.2rem",
                maxWidth: "24rem",
                fontSize: "0.95rem",
                lineHeight: 1.6,
              }}
            >
              <strong>Communication infrastructure for applications.</strong>
              <br />
              Send, receive, observe, and manage the messages your application depends on.
            </p>
            <p className="caption" style={{ marginTop: "1rem" }}>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                style={{ textDecoration: "none", borderBottom: "1px solid var(--border)" }}
              >
                {SUPPORT_EMAIL}
              </a>
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
          <span>© 2026 Calder. Let&rsquo;s build better infrastructure.</span>
          <span style={{ display: "inline-flex", gap: "1.5rem" }}>
            <a href="/legal/privacy">Privacy</a>
            <a href="/legal/terms">Terms</a>
            <a href="/security">Security</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
