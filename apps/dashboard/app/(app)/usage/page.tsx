import { desc, inArray } from "drizzle-orm";
import { getDb, usageSummaries, plans, planPrices, orgUsageSnapshot } from "@calder/db";
import { planEmailsLimit, PLAN_LIMITS } from "@calder/config";
import { getTenantContext } from "../../../lib/auth";
import { pricingUrl } from "../../../lib/pricing";
import { Gauge, Sparkles, ExternalLink, CheckCircle2 } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  StatCard,
} from "../../../components/design-system";

export default async function UsagePage() {
  const ctx = await getTenantContext();
  const orgIds = ctx.memberships.map((m) => m.organization.id);
  const db = getDb();

  const snapshots = await Promise.all(
    ctx.memberships.map(async (m) => ({
      orgName: m.organization.name,
      orgId: m.organization.id,
      snap: await orgUsageSnapshot(db, m.organization.id),
    })),
  );
  const sentThisMonth = snapshots.reduce((n, s) => n + s.snap.acceptedLive, 0);
  const meteredThisMonth = snapshots.reduce((n, s) => n + s.snap.metered, 0);

  const aggregated =
    orgIds.length > 0
      ? await db
          .select()
          .from(usageSummaries)
          .where(inArray(usageSummaries.organizationId, orgIds))
          .orderBy(desc(usageSummaries.periodStart))
          .limit(12)
      : [];

  const tiers = await db.select().from(plans);
  const prices = await db.select().from(planPrices);
  const priceOf = (planId: string, currency: string) =>
    prices.find((p) => p.planId === planId && p.currency === currency);

  return (
    <div>
      <DsPageHeader
        icon={<Gauge size={18} />}
        title="Usage & Quotas"
        badge={<StatusPill status="active" label="Live Ledger" />}
        description="Metered directly from durable delivery records—your invoice always matches this ledger."
        actions={
          <a
            href={pricingUrl()}
            className="ds-btn ds-btn-primary"
            style={{ textDecoration: "none" }}
          >
            <Sparkles size={14} />
            <span>Compare Plans</span>
            <ExternalLink size={13} />
          </a>
        }
      />

      <div className="ds-grid-3" style={{ marginBottom: 20 }}>
        <StatCard
          label="Accepted Sends (Current Cycle)"
          value={sentThisMonth.toLocaleString()}
          status="active"
          sub="Live production API & Composer sends"
        />
        <StatCard
          label="Metered Delivered"
          value={meteredThisMonth.toLocaleString()}
          status="delivered"
          sub="Confirmed remote MX 250 OK"
        />
        <StatCard
          label="Historical Billing Periods"
          value={aggregated.length.toLocaleString()}
          sub="Test-key sends are never metered"
        />
      </div>

      {snapshots.map(({ orgName, orgId, snap }) => {
        const limit = planEmailsLimit(snap.tier);
        const pct =
          limit === null ? 0 : Math.min(100, Math.round((snap.acceptedLive / limit) * 100));
        const hot = limit !== null && pct >= 90;
        const exhausted = limit !== null && snap.acceptedLive >= limit;
        return (
          <section
            key={orgId}
            className="ds-card"
            style={{
              marginBottom: 20,
              borderColor: hot ? "var(--color-danger-border)" : undefined,
            }}
          >
            <div className="ds-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 className="ds-card-title">{orgName}</h2>
                <StatusPill status="active" label={snap.tier.toUpperCase()} />
              </div>
              <div
                className="mono tabular-nums"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: exhausted ? "var(--color-danger)" : "var(--color-ink)",
                }}
              >
                {exhausted ? "Limit reached — sends return plan_limit_reached · " : ""}
                {snap.acceptedLive.toLocaleString()} /{" "}
                {limit === null ? "custom" : limit.toLocaleString()} emails (
                {snap.metered.toLocaleString()} delivered)
              </div>
            </div>

            <div className="ds-card-body">
              <div
                style={{
                  height: 10,
                  borderRadius: 99,
                  background: "var(--color-surface-sunken)",
                  overflow: "hidden",
                }}
                role="progressbar"
                aria-valuenow={snap.acceptedLive}
                aria-valuemax={limit ?? undefined}
                aria-label={`Email usage for ${orgName}`}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(2, pct)}%`,
                    background: exhausted
                      ? "var(--color-danger)"
                      : hot
                        ? "var(--color-warning)"
                        : "var(--color-accent)",
                    transition: "width .3s ease",
                  }}
                />
              </div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "10px 0 0" }}>
                Period {snap.period.start.toISOString().slice(0, 10)} →{" "}
                {snap.period.end.toISOString().slice(0, 10)} · test-key sends are never metered ·{" "}
                {exhausted ? (
                  <>
                    <a
                      href={pricingUrl()}
                      style={{ color: "var(--color-danger)", fontWeight: 600 }}
                    >
                      Upgrade to keep sending
                    </a>{" "}
                    or wait for the period reset.
                  </>
                ) : (
                  <>
                    upgrade anytime on the{" "}
                    <a
                      href={pricingUrl()}
                      style={{ color: "var(--color-ink)", fontWeight: 600 }}
                    >
                      pricing page
                    </a>
                    .
                  </>
                )}
              </p>
            </div>
          </section>
        );
      })}

      <div className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Available Plans & Monthly Quotas</h2>
            <p className="ds-card-subtitle">
              Predictable volume tiers in NGN and USD with hard-cap protection
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          {tiers.length === 0 ? (
            <p style={{ color: "var(--color-muted)", fontSize: 13.5, margin: 0 }}>
              Plans seed at launch—see{" "}
              <a href={pricingUrl()} style={{ color: "var(--color-accent)", fontWeight: 600 }}>
                pricing
              </a>{" "}
              for the full schedule.
            </p>
          ) : (
            <div className="ds-grid-4">
              {tiers.map((t) => {
                const ngn = priceOf(t.id, "NGN");
                const usd = priceOf(t.id, "USD");
                const q = Object.values(PLAN_LIMITS).find(
                  (l) => l.tier === t.tier,
                )?.emailsPerMonth;
                return (
                  <div
                    key={t.id}
                    style={{
                      background: "var(--color-surface-elevated)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-lg)",
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          textTransform: "capitalize",
                        }}
                      >
                        {t.tier}
                      </span>
                      <CheckCircle2 size={14} style={{ color: "var(--color-success)" }} />
                    </div>
                    <p
                      className="mono tabular-nums"
                      style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px" }}
                    >
                      {ngn ? `₦${(ngn.amountCents / 100).toLocaleString()}` : "Custom"} ·{" "}
                      {usd ? `$${usd.amountCents / 100}/mo` : ""}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--color-muted)", margin: 0 }}>
                      {q === null || q === undefined
                        ? "Custom emails/mo"
                        : `${q.toLocaleString()} emails/mo`}{" "}
                      · hard limit enforced
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {aggregated.length > 0 && (
        <div className="ds-table-shell">
          <div className="ds-table-toolbar">
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>Historical Period Summaries</span>
          </div>
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Period Start</th>
                  <th style={{ textAlign: "right" }}>Metered Quantity</th>
                </tr>
              </thead>
              <tbody>
                {aggregated.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.metric}</td>
                    <td className="mono">{u.periodStart.toISOString().slice(0, 10)}</td>
                    <td
                      className="mono tabular-nums"
                      style={{ textAlign: "right", fontWeight: 700 }}
                    >
                      {u.quantity.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
