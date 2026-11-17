import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  emailTotals,
  pipelineDaily,
  platformEmailVolume,
  platformMailTotals,
  transportDistribution,
} from "@/lib/control/queries";
import { AreaChart, BarsChart } from "@/control/_components/charts";
import { BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformEmailPage() {
  await requireSection("platform");
  const [totals, volume, daily, transports, mail] = await Promise.all([
    emailTotals(30),
    platformEmailVolume(),
    pipelineDaily(30),
    transportDistribution(),
    platformMailTotals(30),
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
        <Stat
          label="Customer sends · all time"
          value={fmtInt(volume.liveAccepted)}
          hint={
            volume.testAccepted > 0
              ? `excludes ${fmtInt(volume.testAccepted)} test sends`
              : `${fmtInt(volume.sendingOrgs)} organizations sending`
          }
        />
        <Stat
          label="Calder → users (30d)"
          value={fmtInt(mail.companySent)}
          hint={
            mail.companyFailed > 0
              ? `${fmtInt(mail.companyFailed)} refused by the provider`
              : "sign-in, receipts, announcements"
          }
        />
        <Stat
          label="All mail (30d)"
          value={fmtInt(mail.totalAccepted)}
          hint="customer live + Calder's own"
        />
        <Stat
          label="Emails (30d)"
          value={fmtInt(totals.total)}
          hint={`${fmtInt(totals.today)} today`}
        />
        <Stat label="Delivered (30d)" value={fmtInt(totals.delivered)} />
        <Stat
          label="Delivery rate"
          value={totals.deliveryRate === null ? "—" : fmtPct(totals.deliveryRate)}
          hint="terminal outcomes"
        />
        <Stat
          label="In queue"
          value={fmtInt(totals.queued + totals.sending)}
          hint="created + queued + sending"
        />
        <Stat
          label="Bounced"
          value={fmtInt(totals.bounced)}
          hint={`${fmtInt(totals.complained)} complained`}
        />
      </div>

      <Panel
        title="Both ledgers"
        caption="last 30 days · customer mail and Calder's own, never silently merged"
      >
        <BarList
          items={[
            { label: "Customer mail (live)", count: mail.customerLive },
            { label: "Calder → its users", count: mail.companySent },
            { label: "Test sends (not billable, not in the total)", count: mail.customerTest },
          ]}
        />
        <p className="cp-panel-caption" style={{ padding: "8px 16px 4px" }}>
          {fmtInt(mail.totalAccepted)} messages a provider accepted in this window:{" "}
          {fmtInt(mail.customerLive)} sent by customers through the product,{" "}
          {fmtInt(mail.companySent)} sent by Calder to its own users. The two live in separate
          tables on purpose — a password reset must never appear in a customer&apos;s log or their
          quota — so any page that reports only one of them understates the platform.{" "}
          {mail.companySkipped > 0
            ? `${fmtInt(mail.companySkipped)} Calder messages were skipped (opt-out, duplicate or no provider) and ${fmtInt(
                mail.companyFailed
              )} were refused by the provider.`
            : `${fmtInt(mail.companyFailed)} Calder messages were refused by the provider.`}
        </p>
      </Panel>

      <div className="cp-grid cp-grid-2">
        <Panel title="Accepted sends" caption="per day · last 30 days">
          <BarsChart
            data={daily.map((d) => ({ label: d.day, value: d.created }))}
            caption="accepted sends / day"
          />
        </Panel>
        <Panel title="Delivered" caption="terminal deliveries · last 30 days">
          <AreaChart
            data={daily.map((d) => ({ label: d.day, value: d.delivered }))}
            caption="delivered / day"
          />
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
            Failures and bounces never disappear silently — each one is a row with a reason, visible
            in <Link href="/control/observability">Observability → Logs</Link>.
          </p>
        </Panel>
      </div>
    </>
  );
}
