import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { userRows } from "@/lib/control/queries";
import { fmtDate, fmtInt } from "@/lib/control/format";
import { Empty, PageHeader, Panel, Pager } from "../../_components/ui";

export const dynamic = "force-dynamic";
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireSection("customers");
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 320);
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page ?? "1", 10) || 1));
  // Avoid a default screen containing everyone's contact details: search deliberately.
  const data = q ? await userRows(q, page) : null;
  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Support workspace"
        subtitle="Find an account, inspect its organizations and follow the existing delivery/audit evidence. Read-only investigation—not impersonation or a ticketing system."
      />
      <Panel
        title="Find a customer"
        caption="Search by name or email; access remains platform-role gated"
      >
        <form method="get" className="cp-filters">
          <label htmlFor="support-query">Name or email</label>
          <input
            id="support-query"
            className="cp-input"
            type="search"
            name="q"
            defaultValue={q}
            maxLength={320}
            required
            placeholder="Search customer accounts…"
          />
          <button className="cp-btn primary" type="submit">
            Find account
          </button>
        </form>
      </Panel>
      {data ? (
        <Panel title="Matching accounts" caption={`${fmtInt(data.total)} matches`} flush>
          {data.rows.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Verification</th>
                    <th>Joined</th>
                    <th>Investigation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <b>{user.name ?? "Unnamed account"}</b>
                        <div>{user.email}</div>
                      </td>
                      <td>{user.emailVerifiedAt ? "Verified" : "Unverified"}</td>
                      <td>{fmtDate(user.createdAt)}</td>
                      <td>
                        <Link href={`/control/customers/users/${user.id}`}>Inspect account →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No matching accounts">
              Try another name or email. No account information has been changed.
            </Empty>
          )}
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            query={{ q }}
            basePath="/control/customers/support"
          />
        </Panel>
      ) : (
        <Panel title="Investigation checklist" caption="No account selected">
          <ol>
            <li>Find and verify the account you intend to investigate.</li>
            <li>Open its organization to check project, usage, restriction and audit records.</li>
            <li>
              Check message/provider outcomes before considering any retry. Never resend a
              customer's queue just to test it.
            </li>
          </ol>
        </Panel>
      )}
      <Panel
        title="Not available here"
        caption="No silent elevated sessions or external side effects"
      >
        <p>
          Ticket creation, customer notes, impersonation, courtesy credits and on-behalf resends are
          not implemented in this workspace. Use the existing guarded organization controls for
          approved actions.
        </p>
      </Panel>
    </>
  );
}
