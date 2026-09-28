import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { waitlistOverview, waitlistSources } from "@/lib/control/queries";
import { BarsChart } from "@/control/_components/charts";
import { BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function AcquisitionPage() {
  await requireSection("growth");
  const [sources, overview] = await Promise.all([waitlistSources(), waitlistOverview()]);
  const sorted = [...sources].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((n, s) => n + s.count, 0) || 1;

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Acquisition"
        subtitle="Where people come from. Cost per acquisition arrives with paid campaigns — today every channel is organic effort."
      />

      <div className="cp-stats">
        <Stat label="Channels" value={fmtInt(sorted.length)} hint="tracked sources" />
        <Stat label="Total attributed" value={fmtInt(total)} hint="all waitlist signups" />
        <Stat
          label="Referral share"
          value={fmtPct((overview.referred / total) * 100)}
          hint="referred by another person"
        />
        <Stat
          label="Direct share"
          value={fmtPct(((sorted.find((s) => s.label === "direct")?.count ?? 0) / total) * 100)}
          hint="no source captured"
        />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Signups by source" caption="all time">
          <BarsChart
            data={sorted.map((s) => ({ label: s.label, value: s.count }))}
            caption="signups by source"
          />
        </Panel>
        <Panel title="Share by source" caption="percentage of total signups">
          <BarList
            items={sorted.map((s) => ({
              label: `${s.label} · ${fmtPct((s.count / total) * 100, 0)}`,
              count: s.count,
              href: `/control/growth/waitlist?source=${encodeURIComponent(s.label === "direct" ? "__direct__" : s.label)}`,
            }))}
          />
        </Panel>
      </div>

      <Panel title="Planned instrumentation" caption="tracked in the roadmap, not yet built">
        <div className="cp-planned">
          <b>Conversion &amp; revenue by source</b>
          <p>
            Once accounts convert and billing settles, this page joins acquisition source → plan →
            revenue so you can see which channel brings paying customers, not just signups. UTM
            capture on the public waitlist form is the prerequisite and lands with the marketing
            surface.
          </p>
        </div>
      </Panel>

      <p className="cp-caption">
        Source capture is stored per signup at join time. Historic rows without a captured source
        show as <span className="mono">direct</span>.{" "}
        <Link href="/control/growth/waitlist">Open the waitlist →</Link>
      </p>
    </>
  );
}
