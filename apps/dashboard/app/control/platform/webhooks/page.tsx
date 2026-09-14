import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { webhookStats } from "@/lib/control/queries";
import { BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformWebhooksPage() {
  await requireSection("platform");
  const stats = await webhookStats();
  const attempts = stats.delivered + stats.failed + stats.exhausted + stats.pending;
  const successRate = attempts > 0 ? (stats.delivered / attempts) * 100 : null;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Webhooks"
        subtitle="Event fan-out to customer endpoints — signed, retried with backoff, and every attempt recorded."
      />

      <div className="cp-stats">
        <Stat label="Endpoints" value={fmtInt(stats.endpoints)} hint="customer-registered" />
        <Stat label="Delivery attempts" value={fmtInt(stats.deliveries)} hint="all time" />
        <Stat label="Delivered" value={fmtInt(stats.delivered)} hint={successRate === null ? undefined : fmtPct(successRate)} />
        <Stat label="Exhausted" value={fmtInt(stats.exhausted)} hint="retries ran out — needs attention" />
      </div>

      <Panel title="Delivery states" caption="lifecycle of every webhook attempt">
        <BarList
          items={[
            { label: "delivered", count: stats.delivered },
            { label: "pending", count: stats.pending },
            { label: "failed (retrying)", count: stats.failed },
            { label: "exhausted", count: stats.exhausted },
          ]}
        />
      </Panel>

      <p className="cp-caption">
        Event catalog and signing details: <span className="mono">docs/API.md</span>. Customer-facing webhook config
        lives in their dashboard; this is the platform-side health view.{" "}
        <Link href="/control/observability">Related events in logs →</Link>
      </p>
    </>
  );
}
