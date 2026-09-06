"use client";

import * as React from "react";
import { Reveal } from "./reveal";

/** Real pricing hypothesis from PRD.md §11, in both launch currencies. */
const PLANS = [
  {
    tier: "Free",
    ngn: "₦0",
    usd: "$0",
    quota: "3,000 emails / mo",
    features: [
      "Test + live API keys",
      "Full event lifecycle",
      "Signed webhooks",
      "Community support",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    tier: "Starter",
    ngn: "₦5,000",
    usd: "$7 / mo",
    quota: "25,000 emails / mo",
    features: [
      "Everything in Free",
      "Custom sending domains",
      "Domain health dashboard",
      "Email support",
    ],
    cta: "Choose Starter",
    featured: false,
  },
  {
    tier: "Pro",
    ngn: "₦12,000",
    usd: "$15 / mo",
    quota: "100,000 emails / mo",
    features: [
      "Everything in Starter",
      "Higher rate limits",
      "Webhook retry history",
      "Priority support",
    ],
    cta: "Choose Pro",
    featured: true,
  },
  {
    tier: "Scale",
    ngn: "₦45,000",
    usd: "$50 / mo",
    quota: "500,000 emails / mo",
    features: ["Everything in Pro", "Dedicated guidance", "Usage exports", "Slack support"],
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
          <p className="eyebrow">Pricing</p>
          <h2 className="h2">
            Pricing you can explain <em>to your cofounder.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Four tiers, two currencies from day one, no per-seat arithmetic. Usage is metered from
            the same durable records as everything else — so the invoice always matches what you saw
            in the dashboard.
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
              <a className={`btn ${p.featured ? "btn-paper" : "btn-secondary"}`} href="#start">
                {p.cta}
              </a>
            </Reveal>
          ))}
        </div>
        <Reveal delay={100}>
          <p className="caption" style={{ marginTop: "1.4rem", textAlign: "center" }}>
            Early pricing hypothesis — locked plans publish at launch. Hard limits, no surprise
            overages.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
