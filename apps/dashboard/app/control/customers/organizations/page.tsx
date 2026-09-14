import Link from "next/link";
import { fmtAgo, fmtInt, fmtMoney } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { organizationRows } from "@/lib/control/queries";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: { plan?: string; q?: string };
}) {
  await requireSection("customers");
  const all = await organizationRows();
  const q = searchParams.q?.toLowerCase();
  const filtered = all.filter((o) => {
    if (searchParams.plan && o.plan !== searchParams.plan) return false;
    if (q && !`${o.name} ${o.slug}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const paying = filtered.filter((o) => o.plan && o.plan !== "free");

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Organizations"
        subtitle="Billing and ownership boundary for every customer. Open one for the full 360°: members, projects, plan, usage, audit trail."
      />

      <div className="cp-stats">
        <Stat label="Organizations" value={fmtInt(all.length)} />
        <Stat label="On a paid plan" value={fmtInt(paying.length)} />
        <Stat label="Free tier" value={fmtInt(filtered.filter((o) => !o.plan || o.plan === "free").length)} />
        <Stat
          label="MRR (filtered)"
          value={fmtMoney(paying.reduce((n, o) => n + (o.monthlyCents ?? 0), 0))}
          hint="NGN, active subscriptions"
        />
      </div>

      <Panel title="Directory" caption={`${fmtInt(filtered.length)} organizations · newest first`} flush>
        <form className="cp-filters" method="get" style={{ padding: "12px 16px 0" }}>
          <input
            className="cp-input"
            type="search"
            name="q"
            placeholder="Search name or slug…"
            defaultValue={searchParams.q ?? ""}
            style={{ minWidth: 220 }}
          />
          <select className="cp-select" name="plan" defaultValue={searchParams.plan ?? ""} aria-label="Plan">
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="starter">Builder</option>
            <option value="pro">Pro</option>
            <option value="scale">Scale</option>
          </select>
          <button className="cp-btn primary" type="submit">
            Apply
          </button>
          {(searchParams.q || searchParams.plan) && (
            <Link className="cp-btn" href="/control/customers/organizations">
              Clear
            </Link>
          )}
        </form>

        {filtered.length === 0 ? (
          <Empty title="No organizations match" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Members</th>
                  <th>Projects</th>
                  <th>Plan</th>
                  <th>Period ends</th>
                  <th>MRR</th>
                  <th>Joined</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/control/customers/organizations/${o.id}`}>{o.name}</Link>{" "}
                      <span className="mono" style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                        {o.slug}
                      </span>
                    </td>
                    <td className="cp-num">{fmtInt(o.members)}</td>
                    <td className="cp-num">{fmtInt(o.projects)}</td>
                    <td>
                      {o.plan ? (
                        <Badge tone={o.plan === "free" ? undefined : "accent"}>{o.planName ?? o.plan}</Badge>
                      ) : (
                        <span style={{ color: "var(--cp-faint)" }}>none</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {o.periodEnd ? new Date(o.periodEnd).toISOString().slice(0, 10) : "—"}
                    </td>
                    <td className="cp-num">{o.monthlyCents ? fmtMoney(o.monthlyCents) : "—"}</td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(o.createdAt))}
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${o.id}`}>inspect →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
