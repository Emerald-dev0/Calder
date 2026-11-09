"use client";

import * as React from "react";
import { Reveal } from "./reveal";
import { PLANS, PROGRESSION, CREDIT_OFFERS, BURST_OFFER } from "../lib/plans";

/**
 * Public pricing. Amounts and limits come from the configuration catalogue so
 * this page cannot drift from what the API enforces. Checkout runs through
 * Paystack in USD; when USD is not enabled on the merchant account the pricing
 * page still renders but checkout refuses instead of converting currency.
 */
/**
 * How many bullets fit on a card. Three plans share one row: the card carries
 * the headline features and links to the full table below, which lists every
 * one of them. Retired plans (Premium/Scale) are never rendered.
 */
const CARD_HIGHLIGHTS = 5;

export function Pricing() {
  return (
    <section className="section" id="pricing" style={{ paddingTop: 0 }}>
      <div className="wrap wrap-wide">
        <Reveal>
          <p className="eyebrow">Pricing</p>
          <h2 className="h2">
            Email infrastructure that <em>grows with your application.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Start with 5,000 emails a month on Beginner. Move to Starter or Pro when your volume
            grows. No surprise overage charges, ever: when you reach a limit, sending pauses and
            tells you exactly why, when it resets, and what to do next.
          </p>
        </Reveal>

        <Reveal delay={70}>
          <p className="caption" style={{ marginTop: "1rem" }}>
            All prices in US dollars. Monthly plans bill until you cancel; prepaid credits and Daily
            Burst Passes are one-time purchases.
          </p>
        </Reveal>

        <div className="pricing-grid">
          {PLANS.map((plan, i) => (
            <Reveal
              key={plan.id}
              delay={i * 80}
              // Built as a list, not concatenated. The template literal used to
              // read `price-card${plan.popular ? " featured" : ""}` — one missing
              // space made the class "price-cardfeatured", which matches no rule,
              // so the recommended card rendered as a plain one.
              className={["price-card", plan.popular ? "featured" : null].filter(Boolean).join(" ")}
            >
              <div className="price-head">
                <div className="price-tier">{plan.name}</div>
                {plan.popular && <span className="price-flag">Most popular</span>}
              </div>
              <div className="price-amount">
                {plan.price.USD}
                {plan.volumeRaw !== null && <small>/ month</small>}
              </div>
              <p className="price-promise">{plan.promise}</p>
              <p className="price-quota">{plan.volume}</p>
              <p className="price-quota">Daily submission limit: {plan.daily}</p>
              <ul>
                {plan.highlights.slice(0, CARD_HIGHLIGHTS).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {(plan.plannedHighlights ?? []).slice(0, 2).map((f) => (
                  <li key={f} className="price-planned">
                    <span className="plan-tag">soon</span> {f}
                  </li>
                ))}
              </ul>
              {plan.highlights.length + (plan.plannedHighlights?.length ?? 0) > CARD_HIGHLIGHTS && (
                <a className="price-more" href="#compare">
                  All {plan.highlights.length + (plan.plannedHighlights?.length ?? 0)} features
                  <span aria-hidden="true"> ↓</span>
                </a>
              )}
              <a
                className={plan.popular ? "btn btn-primary" : "btn btn-secondary"}
                href={plan.ctaHref}
              >
                {plan.cta}
              </a>
            </Reveal>
          ))}
        </div>

        <Reveal delay={100}>
          <div className="progression" role="list" aria-label="What each plan is for">
            {PROGRESSION.map((step) => (
              <div className="progression-step" key={step.plan} role="listitem">
                <span className="progression-plan mono">{step.plan}</span>
                <span className="progression-line">{step.line}</span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={110}>
          <div style={{ marginTop: "3rem" }} id="capacity">
            <p className="eyebrow">Need more email capacity?</p>
            <h3 className="h3">Two ways to send more. Neither one is an overage charge.</h3>
            <p className="lede" style={{ marginTop: "0.8rem" }}>
              <strong>Monthly credits</strong> are prepaid packs you buy once and use after your
              included monthly allowance is exhausted. Credits carry forward and each purchase
              expires 12 months after the date you bought it. They never extend your daily limit.
            </p>
            <div className="pricing-grid" style={{ marginTop: "1.4rem" }}>
              {CREDIT_OFFERS.map((offer) => (
                <div className="price-card" key={offer.id}>
                  <div className="price-head">
                    <div className="price-tier">{offer.name}</div>
                  </div>
                  <div className="price-amount">
                    {offer.price}
                    <small>one-time</small>
                  </div>
                  <p className="price-quota">{offer.credits} emails</p>
                  <ul>
                    <li>Used only after your monthly allowance</li>
                    <li>Carries forward, expires 12 months after purchase</li>
                    <li>Stackable with other packs</li>
                  </ul>
                  <a className="btn btn-secondary" href={offer.ctaHref}>
                    {offer.cta}
                  </a>
                </div>
              ))}
            </div>

            <div className="ds-card" style={{ marginTop: "2rem" }}>
              <div className="ds-card-body">
                <p className="eyebrow">Daily Burst Pass</p>
                <h3 className="h3">
                  {BURST_OFFER.price} → {BURST_OFFER.capacity} more submissions today
                </h3>
                <p>
                  A Daily Burst Pass adds daily capacity only. It expires at 23:59:59 UTC on the day
                  you buy it, does not roll over, and never becomes monthly credits. You can buy at
                  most two per account per UTC day, and only when your daily limit has been reached
                  or is insufficient for the request.
                </p>
                <p className="caption">
                  A pass cannot bypass your monthly allowance, an account suspension, compliance
                  requirements, provider limits, or anti-abuse controls.
                </p>
                <a className="btn btn-secondary btn-sm" href={BURST_OFFER.ctaHref}>
                  {BURST_OFFER.cta}
                </a>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="pricing-foot">
            <p className="caption">
              No automatic overage charges, no auto-purchase, and no auto-upgrade. When you reach a
              limit, sending pauses with an error that names it, your usage, and when it resets.
              Nothing is charged without you choosing it.
            </p>
            {/* This block only ever renders on /pricing, so the button used to
                link to the page it was already on. Jump to the table instead. */}
            <a className="btn btn-secondary btn-sm" href="#compare">
              Compare every plan{" "}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
