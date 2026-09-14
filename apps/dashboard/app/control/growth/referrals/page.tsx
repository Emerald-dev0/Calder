import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { waitlistOverview, waitlistTopReferrers } from "@/lib/control/queries";
import { BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  await requireSection("growth");
  const [top, overview] = await Promise.all([waitlistTopReferrers(20), waitlistOverview()]);
  const totalInvites = top.reduce((n, r) => n + r.invites, 0);
  const medianInvites = top.length ? (top[Math.floor(top.length / 2)]?.invites ?? 0) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Referrals"
        subtitle="Who is actually bringing people to Calder? Every signup carries a referral code; this is the leaderboard."
      />

      <div className="cp-stats">
        <Stat label="Referred signups" value={fmtInt(overview.referred)} hint="all time" />
        <Stat label="Referral rate" value={fmtPct(overview.total ? (overview.referred / overview.total) * 100 : 0)} hint="of all signups" />
        <Stat label="Top referrer" value={top[0] ? fmtInt(top[0].invites) : "—"} hint={top[0]?.email ?? "nobody yet"} />
        <Stat label="Median (top 20)" value={fmtInt(medianInvites)} hint="invites per referrer" />
      </div>

      <Panel title="Leaderboard" caption={`${fmtInt(totalInvites)} invites from the top ${top.length} referrers`} flush>
        {top.length === 0 ? (
          <div className="cp-empty">
            <b>No referrals yet</b>
            Every person gets a code at <span className="mono">/waitlist?ref=…</span> — shares will land here.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Person</th>
                  <th>Code</th>
                  <th>Invites</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.code}>
                    <td className="mono" style={{ color: "var(--cp-faint)" }}>
                      {i + 1}
                    </td>
                    <td>
                      <Link href={`/control/growth/waitlist?q=${encodeURIComponent(r.email ?? r.code)}`}>
                        {r.email ?? r.code}
                      </Link>
                    </td>
                    <td className="mono">{r.code}</td>
                    <td className="cp-num">{fmtInt(r.invites)}</td>
                    <td className="cp-num" style={{ color: "var(--cp-muted)" }}>
                      {fmtPct(overview.referred ? (r.invites / overview.referred) * 100 : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Planned: rewards" caption="designed, not built">
        <BarList
          items={[
            { label: "Invite tracking", count: top.length, dim: true },
            { label: "Reward tiers", count: 0, dim: true },
            { label: "Automatic invites on milestone", count: 0, dim: true },
          ]}
        />
        <p className="cp-panel-caption" style={{ marginTop: 10 }}>
          Rewards (skip-the-line, extra seats) are specified but deliberately unbuilt until the waitlist proves the
          referral loop is working organically.
        </p>
      </Panel>
    </>
  );
}
