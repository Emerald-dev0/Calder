import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { customerTotals, userRows } from "@/lib/control/queries";
import { Badge, Empty, PageHeader, Panel, Pager, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  await requireSection("customers");
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const [totals, table] = await Promise.all([customerTotals(), userRows(searchParams.q, page)]);

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Users"
        subtitle="Every person with a Calder account. Open one for their organizations, projects, and platform role."
      />

      <div className="cp-stats">
        <Stat label="Users" value={fmtInt(totals.total)} />
        <Stat label="New this week" value={fmtInt(totals.new7d)} />
        <Stat
          label="Verified"
          value={fmtInt(totals.verified)}
          hint={totals.total ? `${fmtInt(totals.total - totals.verified)} unverified` : undefined}
        />
        <Stat label="Organizations" value={fmtInt(totals.orgs)} />
      </div>

      <Panel
        title="User directory"
        caption={`${fmtInt(table.total)} accounts · ordered by join date`}
        flush
      >
        <form className="cp-filters" method="get" style={{ padding: "12px 16px 0" }}>
          <input
            className="cp-input"
            type="search"
            name="q"
            placeholder="Search name or email…"
            defaultValue={searchParams.q ?? ""}
            style={{ minWidth: 240 }}
          />
          <button className="cp-btn primary" type="submit">
            Search
          </button>
          {searchParams.q ? (
            <Link className="cp-btn" href="/control/customers">
              Clear
            </Link>
          ) : null}
        </form>

        {table.rows.length === 0 ? (
          <Empty title="No users match">Try a different search.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th>Onboarding</th>
                  <th>Platform role</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/control/customers/users/${u.id}`}>{u.name ?? "—"}</Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      <Link href={`/control/customers/users/${u.id}`}>{u.email}</Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(u.createdAt))}
                    </td>
                    <td>
                      <Badge tone={u.emailVerifiedAt ? "ok" : undefined}>
                        {u.emailVerifiedAt ? "verified" : "unverified"}
                      </Badge>
                    </td>
                    <td style={{ color: "var(--cp-muted)" }}>{u.onboardingState}</td>
                    <td>
                      {u.platformRole ? (
                        <Badge tone="accent">{u.platformRole}</Badge>
                      ) : (
                        <span style={{ color: "var(--cp-faint)" }}>customer</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={table.page}
          pages={table.pages}
          total={table.total}
          basePath="/control/customers"
          query={{ q: searchParams.q }}
        />
      </Panel>
    </>
  );
}
