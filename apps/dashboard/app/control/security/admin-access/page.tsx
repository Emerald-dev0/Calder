import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { adminAccounts } from "@/lib/control/queries";
import { CONTROL_ROLE_LABEL, FOUNDER_ONLY_ACTIONS } from "@/lib/control/roles";
import { Badge, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function AdminAccessPage() {
  await requireSection("security");
  const { admins, activeSessions } = await adminAccounts();
  const founders = admins.filter((a) => a.user.platformRole === "founder");

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Admin Access"
        subtitle="Who holds platform power, and how it is bounded. Founder accounts are untouchable through the UI by design."
      />

      <div className="cp-stats">
        <Stat label="Platform admins" value={fmtInt(admins.length)} hint={`${founders.length} founder (env-bootstrapped)`} />
        <Stat label="Active sessions" value={fmtInt(activeSessions)} hint="all users, unexpired" />
        <Stat label="Role changes" value="audited" hint="grant/revoke land in the audit log" />
      </div>

      <Panel title="Platform accounts" caption="users holding a platform role" flush>
        {admins.length === 0 ? (
          <div className="cp-empty">
            <b>No platform roles assigned</b>
            The founder operates via the FOUNDER_EMAILS bootstrap; assign roles in{" "}
            <Link href="/control/administration">Administration → Administrators</Link>.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Active sessions</th>
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

      <Panel title="Boundaries" caption="what no administrator can do to the founder">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: "var(--cp-muted)", lineHeight: 1.9 }}>
          <li>Nobody can remove the founder or transfer platform ownership through the product.</li>
          <li>Nobody can change founder credentials — founder accounts are managed out-of-band.</li>
          <li>{FOUNDER_ONLY_ACTIONS.slice(0, 3).join("; ")} remain founder-only.</li>
        </ul>
        <p className="cp-panel-caption" style={{ marginTop: 10 }}>
          Planned hardening: 2FA/passkeys for platform roles, admin session timeout, re-authentication for dangerous
          actions, IP restrictions.
        </p>
      </Panel>
    </>
  );
}
