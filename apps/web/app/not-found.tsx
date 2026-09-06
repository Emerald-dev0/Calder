import Link from "next/link";
import { AvenorSignal } from "@avenor/ui";
import { Logo } from "../components/logo";

/**
 * 404 — "lost in transit." The missing page is treated like a failed
 * delivery: logged, inspectable, and gracefully rerouted home.
 */
export default function NotFound() {
  return (
    <main className="lost">
      <div className="wrap">
        <div className="lost-top">
          <Link href="/" aria-label="Avenor home">
            <Logo />
          </Link>
        </div>
        <div className="lost-body">
          <span className="lost-ghost" aria-hidden="true">
            404
          </span>
          <AvenorSignal size={76} className="lost-signal" />
          <p className="eyebrow">404 — undeliverable</p>
          <h1 className="display">
            This page never got <em>delivered.</em>
          </h1>
          <p className="lede" style={{ marginTop: "1.4rem" }}>
            No queue entry, no provider record, no event. Whatever you were looking for was never
            sent — or it bounced somewhere between your click and our server.
          </p>
          <div className="lost-event mono" aria-label="Request log">
            <span className="status-dot bad" aria-hidden="true" />
            <span>GET this-page → 404 · logged · request_id req_lost…</span>
            <span className="tag bad">bounced</span>
          </div>
          <div className="hero-ctas">
            <Link className="btn btn-primary" href="/">
              Back home{" "}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </Link>
            <Link className="btn btn-secondary" href="/#developers">
              Read the docs
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
