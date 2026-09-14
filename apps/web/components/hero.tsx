"use client";

import * as React from "react";
import Image from "next/image";
import gsap from "gsap";
import { SignalField } from "./signal-field";
import { SIGNUP_URL } from "../lib/site";
// Static import: hashed URL (immutable CDN caching), auto srcset (scaling),
// blur placeholder. Same-origin asset, no external fetch to fail.
import courierImg from "../public/illustrations/hero-courier-cutout.webp";

const STATES = ["created", "queued", "sending", "sent", "delivered"] as const;
const LATENCIES = ["2ms", "12ms", "180ms", "340ms", "1.02s"] as const;

/**
 * Isolated courier figure for the hero. Module-level so the 1.4s lifecycle
 * timer in Hero never remounts (and restarts) the image or its drift.
 * If the asset ever fails, the hero degrades to copy-only.
 */
function HeroCourier() {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    <figure data-intro className="hero-media" data-parallax="0.06">
      <Image
        src={courierImg}
        alt="Ink illustration of a courier striding forward with a blue envelope"
        sizes="(max-width: 900px) 100vw, 50vw"
        className="hero-courier courier-drift"
        priority
        fetchPriority="high"
        placeholder="blur"
        decoding="async"
        onError={() => setFailed(true)}
      />
      <figcaption className="caption">Carried, not wished.</figcaption>
    </figure>
  );
}

/**
 * Hero: plain-spoken positioning, a live send looping through the real
 * lifecycle, and a WebGL signal field behind it all. GSAP entrance plays
 * once; everything is visible by default if JS fails.
 */
export function Hero() {
  const [step, setStep] = React.useState(STATES.length - 1);
  const rootRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    setStep(0);
    const id = setInterval(() => {
      setStep((s) => (s >= STATES.length ? 0 : s + 1));
    }, 1700);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-intro]",
        { y: 34, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.1, ease: "power3.out", stagger: 0.09, delay: 0.1 }
      );
      gsap.fromTo(
        ".send-visual",
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.3, ease: "power3.out", delay: 0.55 }
      );
    }, root);
    return () => ctx.revert();
  }, []);

  const active = Math.min(step, STATES.length - 1);

  return (
    <section className="hero" id="top" ref={rootRef}>
      <SignalField />
      <div className="hero-fade" aria-hidden="true" />
      <div className="hero-grid-lines" aria-hidden="true" />
      <span className="margin-note" aria-hidden="true">
        communication infrastructure, est. 2026
      </span>
      <div className="wrap hero-inner">
        <div data-intro>
          <div className="hero-copy">
            <p className="eyebrow hero-eyebrow">Communication infrastructure &middot; est. 2026</p>
            <h1 className="display">
              Your application has something to say. <em>Calder makes sure it gets there.</em>
            </h1>
          </div>
        </div>
        <div className="hero-split">
          <div data-intro>
            <p className="lede" style={{ marginTop: "1.6rem" }}>
              Your application needs to send more than email. It needs to welcome people, verify
              accounts, confirm payments, send alerts, announce what&rsquo;s new, and stay connected
              with the people using it. Calder gives you the infrastructure behind those
              conversations &mdash; <strong>one platform, one API, and a complete record of what happened to every message.</strong>
            </p>
            <p style={{ marginTop: "1.2rem", fontSize: "1rem", color: "var(--ink-soft)", fontWeight: 600 }}>
              5,000 emails free every month. No card required.
            </p>
            <div className="hero-ctas">
              <a className="btn btn-primary" href="/waitlist">
                Start free{" "}
                <span className="arrow" aria-hidden="true">
                  &rarr;
                </span>
              </a>
              <a className="btn btn-secondary" href="/docs/quickstart">
                Read the quickstart
              </a>
            </div>
            <div className="hero-meta">
              <span>
                <i />
                202 Accepted in milliseconds
              </span>
              <span>
                <i />
                Every event recorded from send to delivery
              </span>
              <span>
                <i />
                Automatic retries when things go wrong
              </span>
            </div>
          </div>
          <HeroCourier />
        </div>

        <div>
          <div
            className="send-visual"
            role="img"
            aria-label="Animation of an email moving from queued to delivered through Calder"
          >
            <div className="send-visual-bar">
              <span className="traffic" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>live, welcome@example.com</span>
            </div>
            <div className="send-visual-body">
              <div className="send-request" aria-hidden="true">
                <div>
                  <span className="tok-method">POST</span>{" "}
                  <span className="tok-path">/v1/emails</span>
                </div>
                <div>
                  <span className="tok-dim">Idempotency-Key: 7f3a…c91d</span>
                </div>
                <div>
                  <span className="tok-punct">{"{"}</span>
                </div>
                <div>
                  &nbsp;&nbsp;<span className="tok-key">"from"</span>:{" "}
                  <span className="tok-str">"app@acme.com"</span>,
                </div>
                <div>
                  &nbsp;&nbsp;<span className="tok-key">"to"</span>:{" "}
                  <span className="tok-str">"welcome@example.com"</span>,
                </div>
                <div>
                  &nbsp;&nbsp;<span className="tok-key">"subject"</span>:{" "}
                  <span className="tok-str">"Verify your email"</span>,
                </div>
                <div>
                  &nbsp;&nbsp;<span className="tok-key">"html"</span>:{" "}
                  <span className="tok-str">"&lt;p&gt;…&lt;/p&gt;"</span>
                </div>
                <div>
                  <span className="tok-punct">{"}"}</span>
                </div>
                <div style={{ marginTop: "0.6rem" }}>
                  <span className="tok-method">→ 202</span>{" "}
                  <span className="tok-dim">{"{ id: em_9f2…, status: queued }"}</span>
                </div>
              </div>
              <div className="send-states" aria-hidden="true">
                {STATES.map((s, i) => (
                  <div
                    key={s}
                    className={`send-state${i < active ? "done" : ""}${i === active ? "live" : ""}`}
                  >
                    <span className="tick">{i <= active ? "✓" : ""}</span>
                    {s}
                    <span className="latency">{i <= active ? LATENCIES[i] : ""}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="send-loop-hint">
              email.sent → webhook delivered · attempt 1 · 200 OK
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
