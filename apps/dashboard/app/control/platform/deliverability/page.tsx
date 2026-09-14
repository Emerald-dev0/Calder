import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { deliverabilityBySender, emailTotals, gmailCapUsage, recentFailures } from "@/lib/control/queries";
import { Badge, BarList, Dot, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function DeliverabilityPage() {
  await requireSection("platform");
  const [totals, senders, failures, gmail] = await Promise.all([
    emailTotals(30),
    deliverabilityBySender(30),
    recentFailures(10),
    gmailCapUsage(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Deliverability"
        subtitle="Reputation is the product's life support. Sender-level outcomes, Gmail cap usage, and every recent failure with its reason."
      />

      <div className="cp-stats">
        <Stat
          label="Delivery rate (30d)"
          value={totals.deliveryRate === null ? "—" : fmtPct(totals.deliveryRate)}
          hint="target ≥ 97%"
        />
        <Stat label="Bounces (30d)" value={fmtInt(totals.bounced)} invertDelta hint="hard + soft" />
        <Stat label="Complaints (30d)" value={fmtInt(totals.complained)} invertDelta hint="any complaint is investigated" />
        <Stat label="Gmail transports" value={fmtInt(gmail.length)} hint="capped daily, watched here" />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Top senders (30d)" caption="volume with delivered/bounced split" flush>
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Sent</th>
                  <th>Delivered</th>
                  <th>Bounce rate</th>
                </tr>
              </thead>
              <tbody>
                {senders.map((s) => {
                  const sent = Number(s.sent);
                  const bounced = Number(s.bounced);
                  const rate = sent > 0 ? (bounced / sent) * 100 : 0;
                  return (
                    <tr key={s.from}>
                      <td className="mono wrap" style={{ fontSize: 12.5, whiteSpace: "normal" }}>
                        {s.from}
                      </td>
                      <td className="cp-num">{fmtInt(sent)}</td>
                      <td className="cp-num">{fmtInt(Number(s.delivered))}</td>
                      <td>
                        <Badge tone={rate >= 10 ? "bad" : rate >= 5 ? "warn" : "ok"}>{fmtPct(rate)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Gmail cap watch" caption="daily caps enforced pre-send — never over Google's limits">
          {gmail.length === 0 ? (
            <div className="cp-empty">
              <b>No Gmail transports</b>
              Connected Gmail accounts appear here with live cap usage.
            </div>
          ) : (
            <BarList
              items={gmail.map((g) => ({
                label: g.label,
                count: g.sentToday,
              }))}
            />
          )}
          <p className="cp-panel-caption" style={{ padding: "10px 16px 0" }}>
            Over-cap sends fail permanently with an explainable error pointing at graduation — never silently, never
            over Google&rsquo;s limits.
          </p>
        </Panel>
      </div>

      <Panel title="Recent failures" caption="every failure keeps its reason — diagnosable, not dropped" flush>
        {failures.length === 0 ? (
          <div className="cp-empty">
            <b>Clean</b>
            No failed, bounced, or complained messages on record.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Reason</th>
                  <th>Transport</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Dot tone={f.status === "complained" ? "warn" : "bad"} /> {f.status}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {f.to}
                    </td>
                    <td className="wrap" style={{ whiteSpace: "normal", maxWidth: 260 }}>
                      {f.subject}
                    </td>
                    <td className="wrap mono" style={{ fontSize: 12, whiteSpace: "normal", color: "var(--cp-muted)", maxWidth: 280 }}>
                      {f.lastError?.slice(0, 120) ?? "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {f.transport ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="cp-caption">
        Abuse investigation continues in <Link href="/control/security">Security → Abuse</Link>.
      </p>
    </>
  );
}
