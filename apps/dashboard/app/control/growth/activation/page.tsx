import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { organizationActivation } from "@/lib/control/activation";
import { parseRange } from "@/lib/control/range";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { PageHeader, Panel, Stat, KV } from "@/control/_components/ui";

export const dynamic = "force-dynamic";
export default async function ActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requireSection("growth");
  const query = await searchParams;
  const window = parseRange(query.range, query.from, query.to);
  const data = await organizationActivation(window);
  const milestones = [
    ["Organizations created", data.organizations],
    ["Verified owner", data.verified],
    ["Project created", data.projects],
    ["Verified / connected sender", data.senders],
    ["Live provider acceptance recorded", data.activated],
  ] as const;
  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Organization activation"
        subtitle="Which new organizations can reach a real first send? Current milestones for a cohort grouped by organization creation date—not unique people, event order or an inbox-delivery promise."
      />
      <form method="get" className="cp-filters">
        <label htmlFor="activation-range">Created during</label>
        <select className="cp-select" name="range" id="activation-range" defaultValue={window.key}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        <button className="cp-btn" type="submit">
          Apply cohort
        </button>
      </form>
      <div className="cp-stats">
        <Stat label="Organizations in cohort" value={fmtInt(data.organizations)} />
        <Stat
          label="Activated"
          value={fmtInt(data.activated)}
          hint="Live provider ID recorded; current prerequisites met"
        />
        <Stat
          label="Activation share"
          value={data.organizations ? fmtPct((data.activated / data.organizations) * 100) : "—"}
          hint="Activated organizations / cohort"
        />
        <Stat label="Not activated" value={fmtInt(data.organizations - data.activated)} />
      </div>
      <div className="cp-grid cp-grid-2">
        <Panel
          title="Activation milestones"
          caption="Nested current-state counts · each step includes previous prerequisites"
        >
          {milestones.map(([label, count]) => (
            <KV key={label} k={label} v={fmtInt(count)} />
          ))}
          {!data.organizations ? (
            <p>No organizations were created in this cohort. Rates are unavailable, not zero.</p>
          ) : null}
        </Panel>
        <Panel
          title="How to read this"
          caption="Measured from existing records, not browser inference"
        >
          <p>
            Each organization counts once, regardless of members, projects or sends. A verified
            owner is required. Sender status (verified or connected) is current and excludes
            archived senders.
          </p>
          <p>
            Acceptance requires a live-environment message with a provider message ID, excluding the
            simulated provider. Test sends and queue acceptance do not activate an organization.
          </p>
          <p>
            Milestones may be completed after the cohort window. This is not a timestamped
            conversion funnel; losing a verified sender can change the current snapshot. Internal
            organizations are included.
          </p>
          <Link href="/control/customers/organizations">Investigate organizations →</Link>
        </Panel>
      </div>
    </>
  );
}
