import {
  KNOWN_TIERS,
  PLAN_LIMITS,
  UNENFORCED_PLAN_LIMITS,
  planFor,
  type PlanLimit,
  type UnenforcedPlanLimit,
} from "@calder/config";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { organizationsByTier } from "@/lib/control/queries";
import { Badge, PageHeader, Panel, Planned, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

function limit(value: number | null): string {
  return value === null ? "custom" : fmtInt(value);
}

/**
 * One label per recorded-but-unenforced limit. Keyed by the exported union, so
 * adding a limit to `UNENFORCED_PLAN_LIMITS` fails the typecheck until it has a
 * label here — a new limit cannot appear in the matrix as a bare field name.
 */
const UNENFORCED_LABEL: Record<UnenforcedPlanLimit, (plan: PlanLimit) => string> = {
  retentionDays: (plan) => `retention ${limit(plan.retentionDays)}d`,
  gmailSenders: (plan) => `Gmail senders ${limit(plan.gmailSenders)}`,
  inboundStorageMb: (plan) => `inbound storage ${limit(plan.inboundStorageMb)} MB`,
};

function unenforcedSummary(plan: PlanLimit): string {
  return UNENFORCED_PLAN_LIMITS.map((name) => UNENFORCED_LABEL[name](plan)).join(" · ");
}

/**
 * Entitlements are not a separate table: they come from `PLAN_LIMITS` resolved
 * through the organization's active subscription. This matrix is therefore the
 * same source the send path reads, and the organization counts are resolved the
 * same way — so the page cannot claim a limit the product does not enforce.
 *
 * Limits recorded but deliberately not enforced are marked as such rather than
 * quietly presented as guarantees.
 */
export default async function EntitlementsPage() {
  await requireSection("billing");
  const tierCounts = await organizationsByTier();
  const orgsByTier = new Map(tierCounts.map((t) => [t.tier, t.orgs]));
  const totalOrgs = tierCounts.reduce((a, b) => a + b.orgs, 0);
  const tiers = [...KNOWN_TIERS];

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Entitlements"
        subtitle="What each tier actually gets, straight from the configuration the send path enforces, with how many organizations sit on each tier right now."
      />

      <div className="cp-stats">
        <Stat label="Organizations" value={fmtInt(totalOrgs)} hint="across every tier" />
        <Stat
          label="On a paid plan"
          value={fmtInt(
            tierCounts.filter((t) => t.tier !== "free").reduce((a, b) => a + b.orgs, 0)
          )}
          hint="active subscription only"
        />
        <Stat
          label="On Beginner"
          value={fmtInt(orgsByTier.get("free") ?? 0)}
          hint="the fail-closed default"
        />
        <Stat
          label="Retired tiers in use"
          value={fmtInt(
            tiers
              .filter((t) => planFor(t).retired)
              .reduce((a, t) => a + (orgsByTier.get(t) ?? 0), 0)
          )}
          hint="historical subscriptions keep their own limits"
        />
      </div>

      <Panel
        title="Effective limits per tier"
        caption="the same values request handling reads"
        flush
      >
        <div style={{ overflowX: "auto" }}>
          <table className="cp-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Status</th>
                <th className="cp-num">Organizations</th>
                <th className="cp-num">Emails / month</th>
                <th className="cp-num">Live sends / day</th>
                <th className="cp-num">Projects</th>
                <th className="cp-num">Domains</th>
                <th className="cp-num">Senders</th>
                <th className="cp-num">Seats</th>
                <th>Recorded, not enforced</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => {
                const plan = PLAN_LIMITS[tier];
                return (
                  <tr key={tier}>
                    <td>
                      <b>{plan.displayName}</b>{" "}
                      <span className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                        {tier}
                      </span>
                    </td>
                    <td>
                      {plan.retired ? (
                        <Badge tone="warn">retired</Badge>
                      ) : (
                        <Badge tone="ok">sold</Badge>
                      )}
                    </td>
                    <td className="cp-num">{fmtInt(orgsByTier.get(tier) ?? 0)}</td>
                    <td className="cp-num">{limit(plan.emailsPerMonth)}</td>
                    <td className="cp-num">{limit(plan.dailySendCap)}</td>
                    <td className="cp-num">{limit(plan.projects)}</td>
                    <td className="cp-num">{limit(plan.domains)}</td>
                    <td className="cp-num">{limit(plan.senders)}</td>
                    <td className="cp-num">{limit(plan.seats)}</td>
                    <td style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {unenforcedSummary(plan)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="cp-panel-caption" style={{ padding: "10px 16px 12px", margin: 0 }}>
          {`${UNENFORCED_PLAN_LIMITS.length} limits are recorded for transparency but not enforced yet`}
          . An unknown or missing tier resolves to Beginner. Retired tiers are never assigned, but
          existing subscriptions keep exactly the limits they bought. Contact allowance is recorded
          in configuration and is deliberately not enforced or shown.
        </p>
      </Panel>

      <Panel title="Overrides" caption="gated on purpose">
        <Planned
          state="gated"
          title="Per-organization entitlement overrides"
          bullets={[
            "A durable override row with reason, actor and expiry — not an inline exception",
            "Audit record for every grant, change and removal",
            "Meter and quota enforcement reading the same authoritative source",
          ]}
        >
          Temporary plan grants are already possible from an organization&rsquo;s page with an audit
          reason, and those keep working through the same resolution shown above. Ad hoc per-limit
          overrides stay gated: a limit that can disagree with the plan catalogue is how quota bugs
          become billing disputes.
        </Planned>
      </Panel>
    </>
  );
}
