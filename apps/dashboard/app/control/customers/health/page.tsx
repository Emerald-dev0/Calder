import Link from "next/link";
import { fmtAgo, fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { deliverabilityBySender, organizationRows } from "@/lib/control/queries";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CustomerHealthPage() {
  await requireSection("customers");
  const [orgs, senders] = await Promise.all([organizationRows(100), deliverabilityBySender(30)]);

  const paying = orgs.filter((o) => o.plan && o.plan !== "free");
  const withActivity = orgs.filter((o) => o.projects > 0);
  const dormant = orgs.filter((o) => o.projects === 0);
  const struggling = senders
    .map((s) => {
      const sent = Number(s.sent);
      const bounced = Number(s.bounced);
      return {
        from: s.from,
        sent,
        bounceRate: sent > 0 ? (bounced / sent) * 100 : 0,
      };
    })
    .filter((s) => s.sent >= 10 && s.bounceRate >= 5)
    .sort((a, b) => b.bounceRate - a.bounceRate);

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Customer Health"
        subtitle="Who is thriving, who is stuck, and who is quietly failing. Derived from live usage and delivery outcomes — no invented scores."
      />

      <div className="cp-stats">
        <Stat label="Paying customers" value={fmtInt(paying.length)} hint="active paid subscriptions" />
        <Stat label="Active (have projects)" value={fmtInt(withActivity.length)} />
        <Stat label="Dormant (no projects)" value={fmtInt(dormant.length)} hint="onboarding never finished" />
        <Stat
          label="Delivery health (30d)"
          value={senders.length ? fmtPct(100 - struggling.length * 5) : "—"}
          hint={`${struggling.length} senders above 5% bounces`}
        />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Needs attention" caption="senders with elevated bounces, last 30 days" flush>
          {struggling.length === 0 ? (
            <Empty title="Clean">No sender is above the 5% bounce attention line.</Empty>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Sender</th>
                    <th>Sends</th>
                    <th>Bounce rate</th>
                  </tr>
                </thead>
                <tbody>
                  {struggling.map((s) => (
                    <tr key={s.from}>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {s.from}
                      </td>
                      <td className="cp-num">{fmtInt(s.sent)}</td>
                      <td>
                        <Badge tone={s.bounceRate >= 10 ? "bad" : "warn"}>{fmtPct(s.bounceRate)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Dormant organizations" caption="created but never sent — onboarding opportunities" flush>
          {dormant.length === 0 ? (
            <Empty title="Everyone is active" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Plan</th>
                    <th>Joined</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dormant.slice(0, 10).map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/control/customers/organizations/${o.id}`}>{o.name}</Link>
                      </td>
                      <td>{o.planName ?? "free"}</td>
                      <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                        {fmtAgo(new Date(o.createdAt))}
                      </td>
                      <td>
                        <Link href={`/control/customers/organizations/${o.id}`}>inspect →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Planned: health scoring" caption="specified, built with usage metering maturity">
        <div className="cp-planned">
          <b>Composite health score (0–100)</b>
          <p>
            Usage trend, delivery outcome, billing state, and error rates composed into a single score per customer —
            with cohorts like &ldquo;17 Pro customers approaching limits&rdquo; and &ldquo;9 customers suddenly stopped
            sending.&rdquo; Requires sustained usage metering history; the components above are its seeds.
          </p>
        </div>
      </Panel>
    </>
  );
}
