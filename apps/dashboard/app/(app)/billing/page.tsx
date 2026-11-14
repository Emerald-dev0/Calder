import Link from "next/link";
import { CreditCard, Sparkles, Receipt, Info } from "lucide-react";
import { billingSummary, creditSnapshot, orgUsageSnapshot, getDb } from "@calder/db";
import {
  COMMERCIAL_PLAN_ORDER,
  CREDIT_EXPIRY_MONTHS,
  CREDIT_PACKS,
  DAILY_BURST_PASS,
  formatUsdCents,
  planEmailsLimit,
  planFor,
} from "@calder/config";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { billingCapabilities, type FailureCode } from "../../../lib/billing/checkout";
import { DsPageHeader, StatCard, StatusPill } from "../../../components/design-system";
import { startCheckoutAction } from "./actions";
import { PaymentReturnNotice } from "./payment-return-notice";

export const dynamic = "force-dynamic";

/**
 * Why an upgrade attempt came back without a Paystack page. The action
 * redirects with a coarse code so this copy is the only place a customer reads
 * it, and a raw provider message never becomes a query string.
 */
const CHECKOUT_NOTICES: Record<string, { tone: "danger" | "warning"; text: string }> = {
  not_configured: {
    tone: "danger",
    text: "Payments are not connected on this deployment yet, so nothing was charged and your plan is unchanged. Everything else on this page is real data.",
  },
  plan_not_configured: {
    tone: "warning",
    text: "Subscription checkout is not wired up yet, so nothing was charged. Prepaid credit packs are the working path once payments are connected.",
  },
  price_not_configured: {
    tone: "warning",
    text: "That plan has no price configured on this deployment, so nothing was charged.",
  },
  forbidden: {
    tone: "danger",
    text: "Only an owner or admin can buy credits or change the plan.",
  },
  not_found: {
    tone: "danger",
    text: "That payment reference does not belong to this organization.",
  },
  no_project: { tone: "danger", text: "That project is not yours." },
  bad_kind: { tone: "danger", text: "That purchase type is not one we sell." },
  failed: {
    tone: "danger",
    text: "The payment attempt did not complete, so nothing was charged. Try again in a moment.",
  },
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; checkout?: string; ref?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<CreditCard size={18} />}
          title="Billing"
          description="Plan, usage and payments for your workspace."
        />
        <section className="ds-card">
          <div className="ds-card-body">
            <p style={{ margin: 0 }}>You do not have access to any project yet.</p>
          </div>
        </section>
      </div>
    );
  }

  const db = getDb();
  const [usage, credits, billing, capabilities] = await Promise.all([
    orgUsageSnapshot(db, scope.organization.id),
    creditSnapshot(db, scope.organization.id),
    billingSummary(db, scope.organization.id),
    billingCapabilities(),
  ]);

  const plan = planFor(usage.tier);
  const limit = planEmailsLimit(usage.tier);
  const pct = limit === null ? 0 : Math.min(100, Math.round((usage.acceptedLive / limit) * 100));
  const canBuy = scope.role === "owner" || scope.role === "admin";

  // `null` means "we could not ask the API". In that case the buttons stay
  // enabled: the attempt itself reports the truth, which is better than a
  // guess that disables a working checkout.
  const unusableReason =
    capabilities === null
      ? null
      : capabilities.payments === false
        ? "Payments are not connected on this deployment yet. Prices below are the real ones, but checkout will refuse and nothing will be charged."
        : capabilities.usd === false
          ? "Dollar checkout is disabled on this deployment (PAYSTACK_USD_ENABLED is not true), so checkout will refuse and nothing will be charged."
          : null;

  const buyable = canBuy && unusableReason === null;
  const notice = query.checkout
    ? (CHECKOUT_NOTICES[query.checkout as FailureCode] ?? CHECKOUT_NOTICES.failed!)
    : null;
  const back = `/billing?project=${scope.project.id}&email=${encodeURIComponent(ctx.user.email)}`;

  return (
    <div>
      <DsPageHeader
        icon={<CreditCard size={18} />}
        title="Billing"
        badge={
          <StatusPill
            status={billing.subscription?.status === "active" ? "active" : "neutral"}
            label={plan.displayName}
          />
        }
        description={`Plan, usage and payments for ${scope.organization.name}. Amounts are charged in US dollars through Paystack.`}
      />

      {query.ref && <PaymentReturnNotice projectId={scope.project.id} reference={query.ref} />}

      {notice && (
        <section
          className="ds-card"
          style={{
            marginBottom: 20,
            borderColor:
              notice.tone === "danger"
                ? "var(--color-danger-border)"
                : "var(--color-warning-border, var(--color-border))",
          }}
        >
          <div
            className="ds-card-body"
            style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
          >
            <Info size={16} style={{ flex: "none", marginTop: 2 }} />
            <p style={{ margin: 0 }}>{notice.text}</p>
          </div>
        </section>
      )}

      {unusableReason && (
        <section className="ds-card" style={{ marginBottom: 20 }}>
          <div
            className="ds-card-body"
            style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
          >
            <Info size={16} style={{ flex: "none", marginTop: 2 }} />
            <p style={{ margin: 0 }}>
              <strong>Checkout is not open yet.</strong> {unusableReason}
            </p>
          </div>
        </section>
      )}

      <div className="ds-grid-3" style={{ marginBottom: 20 }}>
        <StatCard
          label="Current plan"
          value={plan.displayName}
          status={billing.subscription?.status === "active" ? "active" : undefined}
          sub={
            limit === null
              ? "Custom monthly volume"
              : `${limit.toLocaleString()} emails included per month`
          }
        />
        <StatCard
          label="Used this period"
          value={usage.acceptedLive.toLocaleString()}
          sub={limit === null ? "No platform ceiling" : `${pct}% of the monthly allowance`}
        />
        <StatCard
          label="Prepaid credits"
          value={credits.available.toLocaleString()}
          sub={
            credits.expiringSoon.length > 0
              ? `${credits.expiringSoon[0]!.remaining.toLocaleString()} expire ${credits.expiringSoon[0]!.expiresAt.toISOString().slice(0, 10)}`
              : `Unused credits expire ${CREDIT_EXPIRY_MONTHS} months after purchase`
          }
        />
      </div>

      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 className="ds-card-title">Your plan and this period</h2>
            <StatusPill
              status="neutral"
              label={billing.subscription?.status ?? "no subscription"}
            />
          </div>
          <Link
            href={`/usage?project=${scope.project.id}`}
            className="ds-btn ds-btn-ghost ds-btn-sm"
          >
            Full usage ledger →
          </Link>
        </div>
        <div className="ds-card-body">
          <p style={{ marginTop: 0 }}>
            <strong>{plan.displayName}</strong>
            {plan.retired
              ? " (retired plan — kept exactly as you bought it, no longer sold)"
              : plan.price.USD === null
                ? " (custom contract)"
                : plan.price.USD === 0
                  ? " — free"
                  : ` — ${formatUsdCents(plan.price.USD)} per month`}
            {billing.subscription?.currentPeriodEnd
              ? ` · renews or ends ${billing.subscription.currentPeriodEnd.toISOString().slice(0, 10)}`
              : " · no paid subscription on file"}
          </p>
          <div
            style={{
              height: 10,
              borderRadius: 99,
              background: "var(--color-surface-sunken)",
              overflow: "hidden",
            }}
            role="progressbar"
            aria-valuenow={usage.acceptedLive}
            aria-valuemax={limit ?? undefined}
            aria-label="Monthly email usage"
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(2, pct)}%`,
                background:
                  limit !== null && usage.acceptedLive >= limit
                    ? "var(--color-danger)"
                    : pct >= 90
                      ? "var(--color-warning)"
                      : "var(--color-accent)",
                transition: "width .3s ease",
              }}
            />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
            {usage.acceptedLive.toLocaleString()} of{" "}
            {limit === null ? "unlimited" : limit.toLocaleString()} accepted live sends ·{" "}
            {usage.period.start.toISOString().slice(0, 10)} →{" "}
            {usage.period.end.toISOString().slice(0, 10)} (UTC). Included allowance is consumed
            first; prepaid credits cover only the overage above it.
            {usage.dailyLimit !== null
              ? ` Daily live submissions: ${usage.dailyAcceptedLive.toLocaleString()} of ${(usage.dailyCapacity ?? usage.dailyLimit).toLocaleString()}.`
              : ""}
          </p>
        </div>
      </section>

      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <h2 className="ds-card-title">Change plan</h2>
          <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
            Monthly, billed in USD · cancel any time
          </span>
        </div>
        <div className="ds-card-body">
          {!canBuy && (
            <p style={{ marginTop: 0, color: "var(--color-muted)" }}>
              Your role ({scope.role}) cannot change what this workspace pays. Ask an owner or
              admin.
            </p>
          )}
          <div className="ds-grid-3">
            {COMMERCIAL_PLAN_ORDER.map((tier) => {
              const entry = planFor(tier);
              const isCurrent = usage.tier === tier;
              const purchasable = tier !== "free";
              return (
                <div
                  key={tier}
                  className="ds-card"
                  style={{
                    boxShadow: "none",
                    borderColor: isCurrent ? "var(--color-accent)" : undefined,
                  }}
                >
                  <div className="ds-card-body">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{entry.displayName}</strong>
                      {isCurrent && <StatusPill status="active" label="current" />}
                    </div>
                    <p style={{ fontSize: 20, fontWeight: 700, margin: "8px 0 4px" }}>
                      {entry.price.USD === null
                        ? "Custom"
                        : entry.price.USD === 0
                          ? "Free"
                          : `${formatUsdCents(entry.price.USD)}/mo`}
                    </p>
                    <ul
                      style={{
                        margin: "0 0 12px",
                        paddingLeft: 18,
                        fontSize: 12.5,
                        color: "var(--color-muted)",
                        lineHeight: 1.7,
                      }}
                    >
                      <li>
                        {entry.emailsPerMonth === null
                          ? "Custom monthly volume"
                          : `${entry.emailsPerMonth.toLocaleString()} emails / month`}
                      </li>
                      <li>
                        {entry.dailySendCap === null
                          ? "No daily cap"
                          : `${entry.dailySendCap.toLocaleString()} live sends / day`}
                      </li>
                      <li>{entry.seats === null ? "Custom seats" : `${entry.seats} seats`}</li>
                      <li>
                        {entry.senders === null
                          ? "Custom senders"
                          : `${entry.senders} sender identities`}
                      </li>
                    </ul>
                    {purchasable && !isCurrent && buyable && (
                      <form action={startCheckoutAction}>
                        <input type="hidden" name="projectId" value={scope.project.id} />
                        <input type="hidden" name="kind" value="subscription" />
                        <input type="hidden" name="tier" value={tier} />
                        <input type="hidden" name="email" value={ctx.user.email} />
                        <input type="hidden" name="back" value={back} />
                        <button type="submit" className="ds-btn ds-btn-primary ds-btn-sm">
                          <Sparkles size={14} />
                          <span>Choose {entry.displayName}</span>
                        </button>
                      </form>
                    )}
                    {purchasable && !isCurrent && !buyable && (
                      <span className="ds-btn ds-btn-secondary ds-btn-sm" aria-disabled="true">
                        Checkout closed
                      </span>
                    )}
                    {isCurrent && (
                      <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                        {purchasable ? "You are on this plan." : "Included with every account."}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <h2 className="ds-card-title">Top up without changing plan</h2>
          <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
            One-time purchases · no subscription
          </span>
        </div>
        <div className="ds-card-body">
          <div className="ds-grid-3">
            {CREDIT_PACKS.map((pack) => (
              <div key={pack.id} className="ds-card" style={{ boxShadow: "none" }}>
                <div className="ds-card-body">
                  <strong>{pack.name}</strong>
                  <p style={{ fontSize: 20, fontWeight: 700, margin: "8px 0 4px" }}>
                    {pack.displayPrice}
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--color-muted)", marginTop: 0 }}>
                    {pack.credits.toLocaleString()} email credits, used after your monthly
                    allowance, expiring {CREDIT_EXPIRY_MONTHS} months after purchase.
                  </p>
                  {buyable ? (
                    <form action={startCheckoutAction}>
                      <input type="hidden" name="projectId" value={scope.project.id} />
                      <input type="hidden" name="kind" value="credits" />
                      <input type="hidden" name="packId" value={pack.id} />
                      <input type="hidden" name="email" value={ctx.user.email} />
                      <input type="hidden" name="back" value={back} />
                      <button type="submit" className="ds-btn ds-btn-primary ds-btn-sm">
                        Buy {pack.name.toLowerCase()}
                      </button>
                    </form>
                  ) : (
                    <span className="ds-btn ds-btn-secondary ds-btn-sm" aria-disabled="true">
                      Checkout closed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="ds-card" style={{ boxShadow: "none", marginTop: 16 }}>
            <div className="ds-card-body">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong>
                    {DAILY_BURST_PASS.name} — {DAILY_BURST_PASS.displayPrice}
                  </strong>
                  <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "6px 0 0" }}>
                    Adds {DAILY_BURST_PASS.additionalCapacity.toLocaleString()} submissions for
                    today only (UTC), expiring at 23:59:59. It never adds monthly credits and never
                    bypasses the monthly allowance. Maximum {DAILY_BURST_PASS.maxPerUtcDay} per UTC
                    day — {credits.burstPassesToday} bought today, current extra capacity{" "}
                    {credits.burstCapacityToday.toLocaleString()}.
                  </p>
                </div>
                {buyable ? (
                  <form action={startCheckoutAction}>
                    <input type="hidden" name="projectId" value={scope.project.id} />
                    <input type="hidden" name="kind" value="burst_pass" />
                    <input type="hidden" name="email" value={ctx.user.email} />
                    <input type="hidden" name="back" value={back} />
                    <button
                      type="submit"
                      className="ds-btn ds-btn-secondary ds-btn-sm"
                      disabled={credits.burstPassesToday >= credits.burstPassLimit}
                    >
                      Buy today's pass
                    </button>
                  </form>
                ) : (
                  <span className="ds-btn ds-btn-secondary ds-btn-sm" aria-disabled="true">
                    Checkout closed
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ds-card">
        <div className="ds-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Receipt size={16} />
            <h2 className="ds-card-title">Payment history</h2>
          </div>
          <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
            Most recent {Math.min(50, billing.history.length)} of the last 50
          </span>
        </div>
        <div className="ds-card-body">
          {billing.history.length === 0 ? (
            <p style={{ margin: 0, color: "var(--color-muted)" }}>
              No payments yet. Nothing has been charged to this workspace.
            </p>
          ) : (
            <div className="ds-table-scroll">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Paid</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.history.map((row) => (
                    <tr key={row.reference}>
                      <td className="mono">{row.reference}</td>
                      <td>{row.kind.replace("_", " ")}</td>
                      <td>{row.status}</td>
                      <td className="mono">
                        {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="mono">
                        {row.paidAt ? row.paidAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td className="mono tabular-nums" style={{ textAlign: "right" }}>
                        {(row.amountCents / 100).toFixed(2)} {row.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 0 }}>
            Being sent back from Paystack is not proof of payment. Every row above is confirmed
            server-side against Paystack for the exact amount and currency before anything is
            granted, and a confirmed payment is applied at most once.
          </p>
        </div>
      </section>
    </div>
  );
}
