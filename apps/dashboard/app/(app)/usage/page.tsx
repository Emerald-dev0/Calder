import { desc, inArray } from "drizzle-orm";
import { getDb, usageSummaries, orgUsageSnapshot } from "@calder/db";
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
                {snap.metered.toLocaleString()} provider-accepted)
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
                {exhausted
                  ? "Sending is paused at your current limit. Wait for the period reset or contact support@calder.click."
                  : "Current limits still apply. Paid checkout and self-service upgrades are not available yet."}
              </p>
            </div>
          </section>
        );
      })}

      <section className="ds-card" style={{ marginBottom: 20 }} aria-label="Billing availability">
        <div className="ds-card-body">
          <h2 className="ds-card-title">Billing is not available yet</h2>
          <p style={{ color: "var(--color-muted)", fontSize: 13 }}>
            Paid checkout, subscriptions, and self-service upgrades are not available during
            the initial public launch. Your organization’s current sending and resource limits
            still apply. Usage shown here is not an invoice.
          </p>
        </div>
      </section>

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
