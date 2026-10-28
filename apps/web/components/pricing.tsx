"use client";

import * as React from "react";
import { Reveal } from "./reveal";
import { PLANS, PROGRESSION, type Currency } from "../lib/plans";

/**
 * Plan cards. Four plans, two real currencies, no asterisks: every figure
 * shown is the price someone actually pays (see lib/plans.ts).
 */
/**
 * How many bullets fit on a card. Five plans share one row, so each card is
 * ~200px wide: a fourteen-item list at that width is a wall of text, not a
 * comparison. The card carries the headline features and links to the full
 * table below, which lists every one of them.
 */
const CARD_HIGHLIGHTS = 5;

export function Pricing() {
  const [currency, setCurrency] = React.useState<Currency>("NGN");

  return (
    <section className="section" id="pricing" style={{ paddingTop: 0 }}>
      <div className="wrap wrap-wide">
        <Reveal>
          <p className="eyebrow">Pricing</p>
          <h2 className="h2">
            Start free. <em>Grow when you need to.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Five thousand emails every month. No card. No sales call. No artificial &ldquo;try
            it&rdquo; experience. Build, ship, and grow without paying before you need to.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <div style={{ marginTop: "1.8rem" }} role="group" aria-label="Display currency">
            <div className="currency-toggle">
              {(["NGN", "USD"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                >
                  {c === "NGN" ? "₦ Naira" : "$ Dollars"}
                </button>
              ))}
            </div>
            <p className="caption" style={{ marginTop: "0.6rem" }}>
              Two real prices per plan. Changing the display never changes what you pay.
            </p>
          </div>
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
                {plan.popular && <span className="price-flag">Most teams start here</span>}
              </div>
              <div className="price-amount">
                {plan.price[currency]}
                {plan.volumeRaw !== null && <small>/ month</small>}
              </div>
              <p className="price-promise">{plan.promise}</p>
              <p className="price-quota">{plan.volume}</p>
              <ul>
                {plan.highlights.slice(0, CARD_HIGHLIGHTS).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {plan.highlights.length > CARD_HIGHLIGHTS && (
                <a className="price-more" href="#compare">
                  All {plan.highlights.length} features
                  <span aria-hidden="true"> ↓</span>
                </a>
              )}
              <a
                className={`btn ${plan.popular ? "btn-paper" : "btn-secondary"}`}
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

        <Reveal delay={120}>
          <div className="pricing-foot">
            <p className="caption">
              Limits are hard limits. When you reach one, sending pauses with an error that names
              it, your usage, and when it resets. Nothing is charged without you choosing it.
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
