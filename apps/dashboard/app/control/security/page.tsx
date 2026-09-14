import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { abuseCandidates, emailTotals, gmailCapUsage } from "@/lib/control/queries";
import { Badge, BarList, Dot, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/**
 * Abuse surface: the signals that matter for an email platform, plus the
 * response ladder. Enforcement actions (pause sending, suspend org) land
 * with the restrictions system — listed here as the contract, not faked.
 */
export default async function AbusePage() {
  await requireSection("security");
  const [abuse, totals, gmail] = await Promise.all([abuseCandidates(7), emailTotals(7), gmailCapUsage()]);
  const nearCap = gmail.filter((g) => g.sentToday >= (g.dailyCap ?? 400) * 0.8);

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Abuse"
        subtitle="Calder must never become a spam relay. Unusual sending, spam behavior, bounce and complaint spikes — detected here, acted on through the response ladder."
      />

      <div className="cp-stats">
        <Stat label="Suspicious senders (7d)" value={fmtInt(abuse.suspicious.length)} hint="≥10% bounces or any complaint" />
        <Stat label="Bounces (7d)" value={fmtInt(totals.bounced)} invertDelta />
        <Stat label="Complaints (7d)" value={fmtInt(totals.complained)} invertDelta hint="any is critical" />
        <Stat label="Restricted transports" value={fmtInt(abuse.suspensions)} hint="suspended or revoked" />
      </div>

      <Panel title="Sender review queue" caption="candidate abusers from the last 7 days" flush>
        {abuse.suspicious.length === 0 ? (
          <div className="cp-empty">
            <b>No suspicious senders</b>
            Every sender is within acceptable bounce/complaint bounds this week.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Sends</th>
                  <th>Bounces</th>
                  <th>Bounce rate</th>
                  <th>Complaints</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {abuse.suspicious.map((s) => (
                  <tr key={s.from}>
                    <td className="mono wrap" style={{ fontSize: 12.5, whiteSpace: "normal" }}>
                      {s.from}
                    </td>
                    <td className="cp-num">{fmtInt(s.sent)}</td>
                    <td className="cp-num">{fmtInt(s.bounced)}</td>
                    <td>
                      <Badge tone={s.bounceRate >= 20 ? "bad" : "warn"}>{fmtPct(s.bounceRate)}</Badge>
                    </td>
                    <td className="cp-num">{s.complained > 0 ? <Badge tone="bad">{s.complained}</Badge> : "0"}</td>
                    <td style={{ color: "var(--cp-muted)" }}>investigate</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="cp-grid cp-grid-2">
        <Panel title="Response ladder" caption="proportionate escalation, always audited">
          <BarList
            items={[
              { label: "1 · Warn the customer", count: 1, dim: true },
              { label: "2 · Rate limit the project", count: 2, dim: true },
              { label: "3 · Require verification", count: 3, dim: true },
              { label: "4 · Pause sending", count: 4, dim: true },
              { label: "5 · Suspend project / organization", count: 5, dim: true },
              { label: "6 · Restore (with note)", count: 6, dim: true },
            ]}
          />
          <p className="cp-panel-caption" style={{ padding: "10px 16px 0" }}>
            Enforcement actions execute through Security → Restrictions once wired; every step writes an audit record
            with actor, reason, and before/after.
          </p>
        </Panel>
        <Panel title="Gmail pressure watch" caption="conservative limits by design — Gmail accounts get the tightest caps in the system">
          <BarList
            items={nearCap.map((g) => ({
              label: `${g.label} · ${g.sentToday}/${g.dailyCap ?? 400}`,
              count: g.sentToday,
            }))}
            max={Math.max(1, ...gmail.map((g) => g.dailyCap ?? 400))}
          />
          {nearCap.length === 0 ? (
            <p className="cp-panel-caption" style={{ padding: "10px 16px 0" }}>
              No transport is above 80% of its daily cap.
            </p>
          ) : null}
          <p className="cp-panel-caption" style={{ padding: "10px 16px 0" }}>
            Related: <Link href="/control/platform/deliverability">Deliverability</Link> ·{" "}
            <Link href="/control/security/restrictions">Restrictions</Link>
          </p>
        </Panel>
      </div>

      <p className="cp-caption">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Dot tone="info" /> Suppression list: {fmtInt(abuse.suppressedCount)} addresses protected platform-wide.
        </span>
      </p>
    </>
  );
}
