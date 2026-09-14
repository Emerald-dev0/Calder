"use client";

import * as React from "react";
import { Reveal } from "./reveal";

/** Pricing: Beginner 3proj/2dom/5k, Pro 10/10/50k, Premium 50/50/250k, Scale custom. NGN locally intentional. */
const PLANS = [
  {
  tier: "Beginner",
  label: "Build",
  ngn: "₦0",
  usd: "$0",
  quota: "5,000 emails / mo",
  features: [
  "3 projects · Development env",
  "2 verified domains · SPF/DKIM",
  "5 sender identities",
  "10 templates · variables · preview",
  "API + SMTP + SDK · attachments/CC/BCC",
  "7-day logs · delivery status",
  "2 webhooks · retries + signatures",
  "Basic analytics · delivered/failed",
  ],
  cta: "Start free",
  featured: false,
  },
  {
  tier: "Pro",
  label: "Ship",
  ngn: "₦15,000",
  usd: "$20",
  quota: "50,000 emails / mo",
  features: [
  "Everything in Beginner",
  "10 projects · Dev/Staging/Prod isolation",
  "10 domains + analytics + subdomains",
  "25 senders + sender analytics",
  "100 templates · versioning + rollback",
  "30-day logs · advanced search + export",
  "10 webhooks · replay + logs",
  "Open/click tracking · domain/sender analytics",
  "5 team members · roles",
  ],
  cta: "Choose Pro",
  featured: true,
  },
  {
  tier: "Premium",
  label: "Operate",
  ngn: "₦45,000",
  usd: "$60",
  quota: "250,000 emails / mo",
  features: [
  "Everything in Pro",
  "50 projects + org management",
  "50 domains + health monitoring",
  "500 templates · governance",
  "90-day logs · cross-project search",
  "50 webhooks · advanced retry",
  "IP allowlisting · audit logs · scopes",
  "15 team members · custom permissions",
  "Priority support · deliverability consult",
  ],
  cta: "Choose Premium",
  featured: false,
  },
  {
  tier: "Scale",
  label: "Depend",
  ngn: "Custom",
  usd: "Custom",
  quota: "Custom volume",
  features: [
  "Everything in Premium",
  "Dedicated IP + warmup + routing",
  "Custom throughput + queue config",
  "SLA + architecture review",
  "SSO + enterprise security",
  "Unlimited seats + hierarchy",
  "Dedicated support + migration",
  ],
  cta: "Talk to Calder",
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
  Build → Ship → <em>Operate → Depend.</em>
  </h2>
  <p className="lede" style={{ marginTop: "1.2rem" }}>
  Beginner builds on 5k/mo and 3 projects — generous because Resend gives 3k/3 domains free. Pro is the default for production (50k), Premium adds control (250k), Scale is dedicated infrastructure. NGN locally intentional, USD globally. Included usage + controlled overage, never silent charges.
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
  <div className="price-tier">{p.tier} <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 400, marginLeft: 6 }}>{(p as { label?: string }).label}</span></div>
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
  Included usage + controlled overage (Pro 50k included, then per-1k). Hard limits, no surprise charges. Beginner is honest infrastructure — see full product in the dashboard, locked features show preview not empty.
  </p>
  </Reveal>
 </div>
 </section>
 );
}
