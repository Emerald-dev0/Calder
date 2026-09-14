import Link from "next/link";
import { ilike, or } from "drizzle-orm";
import { users } from "@calder/db";
import { getDb } from "@calder/db";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { CONTROL_ROLE_LABEL, FOUNDER_ONLY_ACTIONS, READ_ONLY_ROLES } from "@/lib/control/roles";
import { adminAccounts } from "@/lib/control/queries";
import { setPlatformRole } from "./actions";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const ASSIGNABLE = [
  { role: "platform_admin", label: "Platform Admin" },
  { role: "support", label: "Support Admin" },
  { role: "billing", label: "Billing Admin" },
  { role: "infrastructure", label: "Infrastructure Admin" },
  { role: "security", label: "Security Admin" },
  { role: "analyst", label: "Analyst" },
] as const;

export default async function AdministratorsPage({
  searchParams,
}: {
  searchParams: { q?: string; promote?: string };
}) {
  const ctx = await requireSection("administration");
  const isFounder = ctx.role === "founder";
  const { admins, activeSessions } = await adminAccounts();

  const db = getDb();
  const q = searchParams.q;
  const candidates = q
    ? await db
        .select({ id: users.id, email: users.email, name: users.name, platformRole: users.platformRole })
        .from(users)
        .where(or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)))
        .limit(8)
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Administrators"
        subtitle="Platform roles are completely separate from customer organization roles. Granting is founder-only, revoking is founder-only, and nothing here can touch a founder account."
      />

      <div className="cp-stats">
        <Stat label="Administrators" value={fmtInt(admins.length)} />
        <Stat label="Active sessions (platform-wide)" value={fmtInt(activeSessions)} />
        <Stat label="Read-only roles" value={fmtInt(READ_ONLY_ROLES.length)} hint="analyst observes, never modifies" />
      </div>

      {!isFounder ? (
        <Panel title="Founder-only area" caption="your role can view but not grant">
          <Empty title="Only the founder grants or revokes platform roles">
            {FOUNDER_ONLY_ACTIONS[0]} is reserved for the founder account.
          </Empty>
        </Panel>
      ) : (
        <Panel title="Find a user to manage" caption="search accounts, then grant or revoke a role" flush>
          <form className="cp-filters" method="get" style={{ padding: "12px 16px 4px" }}>
            <input
              className="cp-input"
              type="search"
              name="q"
              placeholder="Search by email or name…"
              defaultValue={q ?? ""}
              style={{ minWidth: 260 }}
            />
            <button className="cp-btn primary" type="submit">
              Search
            </button>
          </form>
          {candidates.length === 0 ? (
            <Empty title={q ? "No users match" : "Search to promote or manage"} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Current role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link href={`/control/customers/users/${u.id}`}>{u.name ?? "—"}</Link>{" "}
                        <span className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                          {u.email}
                        </span>
                      </td>
                      <td>
                        {u.platformRole ? (
                          <Badge tone={u.platformRole === "founder" ? "ok" : "accent"}>
                            {CONTROL_ROLE_LABEL[u.platformRole]}
                          </Badge>
                        ) : (
                          <span style={{ color: "var(--cp-faint)" }}>customer</span>
                        )}
                      </td>
                      <td>
                        {u.platformRole === "founder" ? (
                          <span style={{ color: "var(--cp-faint)", fontSize: 12.5 }}>managed out-of-band</span>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {ASSIGNABLE.map((a) => (
                              <form
                                key={a.role}
                                action={async () => {
                                  "use server";
                                  await setPlatformRole(u.id, a.role);
                                }}
                              >
                                <button
                                  className="cp-btn"
                                  type="submit"
                                  disabled={u.platformRole === a.role}
                                  style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }}
                                >
                                  {u.platformRole === a.role ? `is ${a.label}` : `→ ${a.label}`}
                                </button>
                              </form>
                            ))}
                            {u.platformRole ? (
                              <form
                                action={async () => {
                                  "use server";
                                  await setPlatformRole(u.id, null);
                                }}
                              >
                                <button
                                  className="cp-btn danger"
                                  type="submit"
                                  style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }}
                                >
                                  Revoke
                                </button>
                              </form>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Current platform accounts" caption="every holder of a platform role" flush>
        {admins.length === 0 ? (
          <Empty title="No platform roles assigned yet">
            The founder operates via the FOUNDER_EMAILS bootstrap until roles are granted here.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Sessions</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.user.id}>
                    <td>
                      <Link href={`/control/customers/users/${a.user.id}`}>{a.user.name ?? "—"}</Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {a.user.email}
                    </td>
                    <td>
                      <Badge tone={a.user.platformRole === "founder" ? "ok" : "accent"}>
                        {CONTROL_ROLE_LABEL[a.user.platformRole as "founder"]}
                      </Badge>
                    </td>
                    <td className="cp-num">{fmtInt(a.sessions)}</td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(a.user.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="cp-caption">
        Role capabilities: <Link href="/control/administration/roles">Roles matrix →</Link> · Every grant and revoke is
        audit-logged with actor, before, and after.
      </p>
    </>
  );
}
