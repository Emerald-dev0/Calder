import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../components/logo";

const ROUTES: Array<{ label: string; href: string; detail: string }> = [
  { label: "Documentation", href: "/docs", detail: "Quickstarts, API reference, SMTP setup" },
  { label: "Pricing", href: "/pricing", detail: "Four plans, free to start" },
  { label: "Status", href: "/status", detail: "Every component, and its history" },
  { label: "Changelog", href: "/changelog", detail: "What shipped, and when" },
];

export const metadata: Metadata = {
  title: "Page not found, Calder",
  description:
    "This message didn't have a destination. The page you're looking for doesn't exist here.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="lost">
      <div className="wrap">
        <div className="lost-top">
          <Link href="/" aria-label="Calder home">
            <Logo />
          </Link>
        </div>
        <div className="lost-body">
          <p className="eyebrow">404 · Route not found</p>
          <h1 className="display">
            This message didn&apos;t have <em>a destination.</em>
          </h1>
          <p className="lede" style={{ marginTop: "1.4rem" }}>
            The page you&apos;re looking for doesn&apos;t exist here.
          </p>
          <p style={{ marginTop: "0.8rem", color: "var(--ink-soft)" }}>
            Maybe the link is old. Maybe the page moved. Maybe you just took a wrong turn.
          </p>
          <p style={{ marginTop: "0.4rem", color: "var(--ink-soft)" }}>
            Either way, nothing is waiting in a queue.
          </p>

          <div style={{ marginTop: "2rem" }}>
            <Link className="btn btn-primary" href="/">
              Back home{" "}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </div>

          <div
            className="lost-event mono"
            aria-label="Delivery status"
            style={{ marginTop: "2.5rem" }}
          >
            <span>STATUS</span>
            <span>404</span>
            <span style={{ marginLeft: "1.5rem" }}>ROUTE</span>
            <span>not_found</span>
            <span style={{ marginLeft: "1.5rem" }}>REQUEST</span>
            <span>received</span>
            <span style={{ marginLeft: "1.5rem" }}>DELIVERY</span>
            <span>not_applicable</span>
          </div>

          <nav
            className="lost-routes"
            aria-label="Useful destinations"
            style={{ marginTop: "2.5rem" }}
          >
            {ROUTES.map((r) => (
              <Link className="lost-route" href={r.href} key={r.href}>
                <span className="lost-route-label">{r.label}</span>
                <span className="lost-route-detail">{r.detail}</span>
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            ))}
          </nav>

          <p className="caption" style={{ marginTop: "1.6rem" }}>
            Found a broken link? <a href="mailto:support@calder.click">Tell us.</a>
          </p>
        </div>
      </div>
    </main>
  );
}
