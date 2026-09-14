import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { emailTotals, pipelineDaily, transportDistribution } from "@/lib/control/queries";
import { AreaChart, BarsChart } from "@/control/_components/charts";
import { BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformEmailPage() {
  await requireSection("platform");
  const [totals, daily, transports] = await Promise.all([
    emailTotals(30),
    pipelineDaily(30),
    transportDistribution(),
  ]);
  const transportBars = transports.map((t) => ({
    label: `${t.transport ?? "?"}${t.provider ? ` · ${t.provider}` : ""}`,
    count: Number(t.value),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Email"
        subtitle="The delivery engine itself: volume, outcomes, and what transport actually moved every message. One pipeline — API and SMTP land in the same numbers."
      />

      <div className="cp-stats">
        <Stat label="Emails (30d)" value={fmtInt(totals.total)} hint={`${fmtInt(totals.today)} today`} />
        <Stat label="Delivered (30d)" value={fmtInt(totals.delivered)} />
        <Stat
          label="Delivery rate"
          value={totals.deliveryRate === null ? "—" : fmtPct(totals.deliveryRate)}
          hint="terminal outcomes"
        />
        <Stat label="In queue" value={fmtInt(totals.queued + totals.sending)} hint="created + queued + sending" />
        <Stat label="Bounced" value={fmtInt(totals.bounced)} hint={`${fmtInt(totals.complained)} complained`} />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Accepted sends" caption="per day · last 30 days">
          <BarsChart data={daily.map((d) => ({ label: d.day, value: d.created }))} caption="accepted sends / day" />
        </Panel>
        <Panel title="Delivered" caption="terminal deliveries · last 30 days">
          <AreaChart data={daily.map((d) => ({ label: d.day, value: d.delivered }))} caption="delivered / day" />
        </Panel>
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Transports" caption="what moved the mail">
          <BarList items={transportBars} />
        </Panel>
        <Panel title="Outcome mix (30d)" caption="every terminal state, counted">
          <BarList
            items={[
              { label: "delivered", count: totals.delivered },
              { label: "failed", count: totals.failed },
              { label: "bounced", count: totals.bounced },
              { label: "complained", count: totals.complained },
            ]}
          />
          <p className="cp-panel-caption" style={{ padding: "8px 16px 4px" }}>
            Failures and bounces never disappear silently — each one is a row with a reason, visible in{" "}
            <Link href="/control/observability">Observability → Logs</Link>.
          </p>
        </Panel>
      </div>
    </>
  );
}
