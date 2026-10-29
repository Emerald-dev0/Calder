import Link from "next/link";
import { reportingEnvironment } from "@/lib/control/environment";
import { requireSection } from "@/lib/control/guard";
import { deliveryOutcomeSummary, queueDerived, webhookStats } from "@/lib/control/queries";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { KV, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function MetricsPage({
  searchParams,
}: {
  searchParams?: Promise<{ env?: string }>;
}) {
  await requireSection("observability");
  const environment = reportingEnvironment((await searchParams)?.env);
  const [outcomes, queue, hooks] = await Promise.all([
    deliveryOutcomeSummary(30, environment),
    queueDerived(environment),
    webhookStats(),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Operational metrics"
        subtitle="Current delivery states, outstanding work and webhook failures from durable records. Refreshed on page load; not a worker heartbeat."
      />
      <form method="get" className="cp-filters" aria-label="Reporting environment">
        <label htmlFor="metrics-env">Email environment</label>
        <select id="metrics-env" name="env" className="cp-select" defaultValue={environment}>
          <option value="live">Live sends</option>
          <option value="test">Test simulations</option>
          <option value="all">All environments</option>
        </select>
        <button className="cp-btn" type="submit">
          Apply filter
        </button>
        <span className="cp-panel-caption">
          Email outcomes/backlog: {environment}. Webhooks: all environments.
        </span>
      </form>
      <div className="cp-stats">
        <Stat
          label="Messages created · 30d"
          value={fmtInt(outcomes.started)}
          hint="All statuses; cohort by creation time"
        />
        <Stat
          label="Sent status · 30d"
          value={fmtInt(outcomes.sent)}
          hint={
            environment === "live"
              ? "Provider accepted, awaiting feedback; not inbox delivery"
              : "May include simulations; not inbox delivery"
          }
        />
        <Stat
          label="Delivered status · 30d"
          value={fmtInt(outcomes.delivered)}
          hint="Recorded delivered status"
        />
        <Stat
          label="Delivery rate · 30d"
          value={outcomes.deliveryRate === null ? "—" : fmtPct(outcomes.deliveryRate)}
          hint="Delivered / terminal outcomes; excludes pending feedback"
        />
      </div>
      <div className="cp-grid cp-grid-2">
        <Panel
          title="Outstanding sending work"
          caption="All-time current database state · not BullMQ counters"
        >
          <KV k="In flight" v={fmtInt(queue.inFlight)} />
          <KV
            k="Oldest created / queued message"
            v={
              queue.oldestAgeMinutes === null
                ? "No waiting messages"
                : `${queue.oldestAgeMinutes} min`
            }
          />
          <KV k="Failed / bounced · updated in last 24h" v={fmtInt(queue.failedRecent)} />
          <Link href="/control/infrastructure/queues">Inspect queue records →</Link>
        </Panel>
        <Panel
          title="Delivery outcomes"
          caption="Messages created in the last 30 UTC calendar days"
        >
          <KV k="Failed" v={fmtInt(outcomes.failed)} />
          <KV k="Bounced" v={fmtInt(outcomes.bounced)} />
          <KV k="Complained" v={fmtInt(outcomes.complained)} />
          <KV k="Suppressed" v={fmtInt(outcomes.suppressed)} />
          <p className="cp-panel-caption">
            Rates use current terminal statuses, not a provider-standard reputation denominator.
            Absent provider feedback is not proof of delivery.
          </p>
        </Panel>
        <Panel
          title="Webhook delivery"
          caption="All environments · all-time current delivery states (not filtered)"
        >
          <KV k="Endpoints" v={fmtInt(hooks.endpoints)} />
          <KV k="Pending" v={fmtInt(hooks.pending)} />
          <KV k="Failed" v={fmtInt(hooks.failed)} />
          <KV k="Exhausted retries" v={fmtInt(hooks.exhausted)} />
        </Panel>
        <Panel title="Instrumentation gaps" caption="Not yet measured here">
          <p>
            API latency percentiles, provider latency and historical queue depth require durable
            instrumentation. They are not inferred from message counts.
          </p>
          <p>Website and acquisition analytics remain in Growth. Billing is not configured.</p>
        </Panel>
      </div>
    </>
  );
}
