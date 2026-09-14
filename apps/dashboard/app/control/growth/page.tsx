import Link from "next/link";
import {
  cumulative,
  denseDaily,
  fmtInt,
  fmtPct,
  parseRange,
  pctChange,
  rangeToDays,
} from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  customerTotals,
  waitlistDailyCounts,
  waitlistOverview,
  waitlistSources,
  waitlistTopReferrers,
} from "@/lib/control/queries";
import { AreaChart } from "@/control/_components/charts";
import { BarList, PageHeader, Panel, RangeTabs, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function GrowthOverview({ searchParams }: { searchParams: { range?: string } }) {
  await requireSection("growth");
  const range = parseRange(searchParams.range);
  const days = rangeToDays(range);
  const [overview, daily, sources, topReferrers, customers] = await Promise.all([
    waitlistOverview(),
    waitlistDailyCounts(days),
    waitlistSources(),
    waitlistTopReferrers(6),
    customerTotals(),
  ]);

  const cumulativeSeries = cumulative(denseDaily(daily, days, new Date()));
  const growth = pctChange(overview.new7d, overview.prev7d);

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Overview"
        subtitle="Calder is pre-launch: the waitlist is the business. Account signups ride alongside as the second signal."
        right={<RangeTabs current={range} basePath="/control/growth" />}
      />

      <div className="cp-stats">
        <Stat label="Waitlist" value={fmtInt(overview.total)} delta={growth} hint={`+${fmtInt(overview.new7d)} this week`} />
        <Stat label="New today" value={fmtInt(overview.newToday)} hint="waitlist joins" />
        <Stat
          label="Conversion"
          value={fmtPct(overview.total ? (overview.converted / overview.total) * 100 : 0)}
          hint="waitlist → account"
        />
        <Stat label="Accounts" value={fmtInt(customers.total)} hint={`+${fmtInt(customers.new7d)} this week`} />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Cumulative waitlist growth" caption="total people waiting · all activity in range">
          <AreaChart
            data={cumulativeSeries.map((p) => ({ label: p.day, value: p.count }))}
            caption="cumulative waitlist"
          />
        </Panel>
        <Panel title="Where growth comes from" caption="signups by acquisition source">
          <BarList
            items={topDistributionSafe(sources).map((s) => ({
              label: s.label,
              count: s.count,
              href: `/control/growth/waitlist?source=${encodeURIComponent(s.label === "direct" ? "__direct__" : s.label)}`,
            }))}
          />
        </Panel>
      </div>

      <Panel title="Jump to" caption="the growth workspace">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="cp-btn primary" href="/control/growth/waitlist">
            Waitlist database
          </Link>
          <Link className="cp-btn" href="/control/growth/acquisition">
            Acquisition
          </Link>
          <Link className="cp-btn" href="/control/growth/referrals">
            Referrals
          </Link>
        </div>
        {topReferrers[0] ? (
          <p className="cp-panel-caption" style={{ marginTop: 12 }}>
            Top referrer this period: <span className="mono">{topReferrers[0].email ?? topReferrers[0].code}</span> with{" "}
            {fmtInt(topReferrers[0].invites)} invites.
          </p>
        ) : null}
      </Panel>
    </>
  );
}

function topDistributionSafe(items: Array<{ label: string; count: number }>) {
  return [...items].sort((a, b) => b.count - a.count).slice(0, 8);
}
