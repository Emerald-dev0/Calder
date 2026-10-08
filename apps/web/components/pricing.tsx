import { Reveal } from "./reveal";
import { PLANS, PROGRESSION } from "../lib/plans";

/**
 * Plan cards. Free is live today. Paid plans are announced but not purchasable
 * yet, so they never show a price as if checkout existed (see lib/plans.ts).
 */
export function Pricing() {
  return (
    <section className="section" id="pricing" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal>
          <p className="eyebrow">Pricing</p>
          <h2 className="h2">
            Start free. <em>Grow when you need to.</em>
          </h2>
          <p className="lede" style={{ marginTop: "1.2rem" }}>
            Five thousand emails every month. No card. No sales call. Paid plans are on the way,
            and Free stays free while you build.
          </p>
        </Reveal>

        <div className="pricing-grid">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 80} className="price-card">
              <div className="price-head">
                <div className="price-tier">{plan.name}</div>
                {!plan.available && plan.id !== "scale" && (
                  <span className="price-flag">Coming soon</span>
                )}
              </div>
              <div className="price-amount">
                {plan.available ? (
                  <>
                    {plan.price.USD}
                    <small>/ month</small>
                  </>
                ) : plan.id === "scale" ? (
                  "Custom"
                ) : (
                  "Soon"
                )}
              </div>
              <p className="price-promise">{plan.promise}</p>
              <p className="price-quota">{plan.volume}</p>
              <ul>
                {plan.highlights.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {plan.ctaHref ? (
                <a
                  className={`btn ${plan.available ? "btn-primary" : "btn-secondary"}`}
                  href={plan.ctaHref}
                >
                  {plan.cta}
                </a>
              ) : (
                <button className="btn btn-secondary" type="button" disabled>
                  {plan.cta}
                </button>
              )}
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
              Paid plan limits shown here are planned and may change before launch.
            </p>
            <a className="btn btn-secondary btn-sm" href="/pricing">
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
