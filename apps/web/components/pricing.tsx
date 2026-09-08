"use client";

import * as React from "react";
import { Reveal } from "./reveal";

/** Pricing hypothesis from PRD.md §11 — NGN leads, USD set at launch parity review. */
const PLANS = [
  {
    tier: "Free",
    ngn: "₦0",
    usd: "$0",
    quota: "3,000 emails / mo",
    features: [
      "Gmail connection for beginners",
      "1 custom domain",
      "API + SMTP + SDK",
      "Templates + basic logs + 1 webhook",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    tier: "Builder",
    ngn: "≈ ₦3,500",
    usd: "TBD",
    quota: "~25,000 emails / mo",
    features: [
      "Everything in Free",
      "5 domains + campaigns",
      "Multiple webhooks",
      "Better retention",
    ],
    cta: "Choose Builder",
    featured: true,
  },
  {
    tier: "Pro",
    ngn: "≈ ₦7,500",
    usd: "TBD",
    quota: "~75,000 emails / mo",
    features: [
      "Everything in Builder",
      "20 domains + improved analytics",
      "Larger retention",
      "Team functionality",
    ],
    cta: "Choose Pro",
    featured: false,
  },
  {
    tier: "Scale",
    ngn: "≈ ₦20,000",
    usd: "TBD",
    quota: "~250,000 emails / mo",
    features: [
      "Everything in Pro",
      "Significantly higher limits",
      "Advanced analytics",
      "Priority support",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

type Currency = "NGN" | "USD";

export function Pricing() {
  const [currency, setCurrency] = React.useState<Currency>("NGN");

  return (
    <section className="section" id="pricing" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Pricing · hypothesis, not promise</p>
          <h2 className="h2">
            Priced for where <em>you build.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Naira-first plans a Nigerian builder can actually pay — no per-seat arithmetic, no
            overage traps. Usage is metered from the same durable records as everything else, so the
            invoice always matches your dashboard. Final numbers lock after our unit-economics
            review.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <div style={{ marginTop: "1.8rem" }} role="group" aria-label="Display currency">
            <div className="currency-toggle">
              {(["NGN", "USD"] as const).map((c) => (
                <button key={c} aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                  {c === "NGN" ? "₦ NGN" : "$ USD"}
                </button>
              ))}
            </div>
          </div>
        </Reveal>
        <div className="pricing-grid">
          {PLANS.map((p, i) => (
            <Reveal
              key={p.tier}
              delay={i * 90}
              className={`price-card${p.featured ? "featured" : ""}`}
            >
              <div className="price-tier">{p.tier}</div>
              <div className="price-amount">
                {currency === "NGN" ? p.ngn : p.usd} <small>/ mo</small>
              </div>
              <div className="price-both">
                {currency === "NGN" ? p.usd : p.ngn} in {currency === "NGN" ? "USD" : "NGN"}
              </div>
              <p className="price-quota">{p.quota}</p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a className={`btn ${p.featured ? "btn-paper" : "btn-secondary"}`} href="/waitlist">
                {p.cta}
              </a>
            </Reveal>
          ))}
        </div>
        <Reveal delay={100}>
          <p className="caption" style={{ marginTop: "1.4rem", textAlign: "center" }}>
            Hypothesis under unit-economics review (docs/PRICING.md) — locked plans publish at
            launch. Hard limits, no surprise overages. USD equivalents set at launch parity.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
