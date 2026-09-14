import type { Metadata } from "next";
import Link from "next/link";
import { CalderSignal } from "@calder/ui";
import { Logo } from "../components/logo";

/** Where people actually want to go when a link dies. */
const ROUTES: Array<{ label: string; href: string; detail: string }> = [
  { label: "Documentation", href: "/docs", detail: "Quickstarts, API reference, SMTP setup" },
  { label: "Pricing", href: "/pricing", detail: "Four plans, free to start" },
  { label: "Status", href: "/status", detail: "Every component, and its history" },
  { label: "Changelog", href: "/changelog", detail: "What shipped, and when" },
];

export const metadata: Metadata = {
  title: "Page not found, Calder",
  description:
    "That page was never delivered. Back to the docs, pricing, status page, or changelog.",
  robots: { index: false, follow: true },
};

/**
 * 404, "lost in transit." The missing page is treated like a failed
 * delivery: logged, inspectable, and rerouted somewhere useful.
 */
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
          <span className="lost-ghost" aria-hidden="true">
            404
          </span>
          <CalderSignal size={76} className="lost-signal" />
          <p className="eyebrow">404, undeliverable</p>
          <h1 className="display">
            This page never got <em>delivered.</em>
          </h1>
          <p className="lede" style={{ marginTop: "1.4rem" }}>
            No queue entry, no provider record, no event. Whatever you were looking for was never
            sent, or it bounced somewhere between your click and our server.
          </p>
          <div className="lost-event mono" aria-label="Request log">
            <span className="status-dot bad" aria-hidden="true" />
            <span>GET this-page → 404 · logged · request_id req_lost…</span>
            <span className="tag bad">bounced</span>
          </div>

          <nav className="lost-routes" aria-label="Useful destinations">
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

          <div className="hero-ctas">
            <Link className="btn btn-primary" href="/">
              Back home{" "}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <Link className="btn btn-secondary" href="/docs">
              Read the docs
            </Link>
          </div>

          <p className="caption" style={{ marginTop: "1.6rem" }}>
            Followed a link from somewhere else and it broke?{" "}
            <a href="mailto:support@calder.click">Tell us where</a> and we will fix it.
          </p>
        </div>
      </div>
    </main>
  );
}
