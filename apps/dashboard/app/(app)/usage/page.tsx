import { desc, inArray } from "drizzle-orm";
import {
  getDb,
  usageSummaries,
  orgUsageSnapshot,
  creditSnapshot,
  billingSummary,
} from "@calder/db";
import { planEmailsLimit } from "@calder/config";
import { getTenantContext } from "../../../lib/auth";
import { Gauge } from "lucide-react";
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
      credits: await creditSnapshot(db, m.organization.id),
      billing: await billingSummary(db, m.organization.id),
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

  return (
    <div>
      <DsPageHeader
        icon={<Gauge size={18} />}
        title="Usage & Quotas"
        badge={<StatusPill status="active" label="Live Ledger" />}
        description="Accepted live sends, provider-accepted usage, and your current limits."
      />

      <div className="ds-grid-3" style={{ marginBottom: 20 }}>
        <StatCard
          label="Accepted Sends (Current Cycle)"
          value={sentThisMonth.toLocaleString()}
          status="active"
          sub="Live production API & Composer sends"
        />
        <StatCard
          label="Provider-Accepted Sends"
          value={meteredThisMonth.toLocaleString()}
          sub="Provider acceptance is not inbox delivery"
        />
        <StatCard
          label="Recorded Usage Summaries"
          value={aggregated.length.toLocaleString()}
          sub="Test-key sends are never metered"
        />
      </div>

      {snapshots.map(({ orgName, orgId, snap, credits }) => {
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
                {snap.metered.toLocaleString()} provider-accepted)
              </div>
            </div>

            <div className="ds-card-body">
              {snap.dailyLimit !== null && (
                <p>
                  Daily live submissions: {snap.dailyAcceptedLive.toLocaleString()} /{" "}
                  {(snap.dailyCapacity ?? snap.dailyLimit).toLocaleString()} used
                  {snap.burstCapacityToday > 0
                    ? ` (${snap.burstCapacityToday.toLocaleString()} from ${snap.burstPassesToday} Daily Burst Pass${snap.burstPassesToday === 1 ? "" : "es"})`
                    : ""}{" "}
                  · resets {snap.dailyPeriod.end.toISOString()} (UTC). A pass adds daily capacity
                  only — it never adds monthly credits.
                </p>
              )}
              <p>
                Prepaid credits: <strong>{snap.creditsAvailable.toLocaleString()}</strong> available.
                Included monthly allowance is always consumed first; credits cover only the
                overage above it and never extend the daily limit.
                {credits.expiringSoon.length > 0
                  ? ` Next expiry: ${credits.expiringSoon[0]!.remaining.toLocaleString()} credits on ${credits.expiringSoon[0]!.expiresAt.toISOString().slice(0, 10)}.`
                  : ""}
              </p>
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
                {exhausted
                  ? "Sending is paused at your current limit. Buy prepaid credits or a Daily Burst Pass, or wait for the reset."
                  : "Included allowance is consumed first; prepaid credits cover only overage above it."}{" "}
                <a href="https://calder.click/pricing#capacity">View credits and passes →</a>
              </p>
            </div>
          </section>
        );
      })}

      {snapshots.map(({ orgName, orgId, credits, billing }) => (
        <section key={`${orgId}-credits`} className="ds-card" style={{ marginBottom: 20 }}>
          <div className="ds-card-header">
            <h2 className="ds-card-title">{orgName}: credits, passes & payments</h2>
            <StatusPill
              status={billing.subscription?.status === "active" ? "active" : "neutral"}
              label={billing.subscription ? billing.subscription.status.replace("_", " ") : "free"}
            />
          </div>
          <div className="ds-card-body">
            <p>
              Plan: <strong>{billing.subscription?.tier ?? "free"}</strong>
              {billing.subscription?.currentPeriodEnd
                ? ` · renews or ends ${billing.subscription.currentPeriodEnd.toISOString().slice(0, 10)}`
                : " · no paid subscription"}
            </p>
            <p>
              Daily Burst Passes today: {credits.burstPassesToday} of {credits.burstPassLimit} ·
              current extra daily capacity {credits.burstCapacityToday.toLocaleString()}.
            </p>
            <p style={{ color: "var(--color-muted)", fontSize: 13 }}>
              A Daily Burst Pass costs $1 and adds 1,000 submissions for today only, expiring at
              23:59:59 UTC. It does not roll over, does not add monthly credits, and cannot
              bypass the monthly allowance, account suspension, compliance checks, provider
              limits, or anti-abuse controls.
            </p>

            {credits.purchases.length > 0 && (
              <div className="ds-table-scroll" style={{ marginTop: 12 }}>
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Credit purchase</th>
                      <th>Purchased</th>
                      <th>Expires</th>
                      <th style={{ textAlign: "right" }}>Remaining</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credits.purchases.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.packId}</td>
                        <td className="mono">{p.purchasedAt.toISOString().slice(0, 10)}</td>
                        <td className="mono">{p.expiresAt.toISOString().slice(0, 10)}</td>
                        <td className="mono tabular-nums" style={{ textAlign: "right" }}>
                          {p.creditsRemaining.toLocaleString()} / {p.creditsPurchased.toLocaleString()}
                        </td>
                        <td className="mono tabular-nums" style={{ textAlign: "right" }}>
                          ${(p.amountCents / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {billing.history.length > 0 && (
              <div className="ds-table-scroll" style={{ marginTop: 16 }}>
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Kind</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.history.map((h) => (
                      <tr key={h.reference}>
                        <td className="mono">{h.reference}</td>
                        <td>{h.kind.replace("_", " ")}</td>
                        <td>{h.status}</td>
                        <td className="mono">{h.createdAt.toISOString().slice(0, 10)}</td>
                        <td className="mono tabular-nums" style={{ textAlign: "right" }}>
                          ${(h.amountCents / 100).toFixed(2)} {h.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ))}

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
