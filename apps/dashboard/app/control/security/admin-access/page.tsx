import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { adminAccounts } from "@/lib/control/queries";
import { CONTROL_ROLE_LABEL } from "@/lib/control/roles";
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
        <Stat
          label="Platform admins"
          value={fmtInt(admins.length)}
          hint={`${founders.length} founder (env-bootstrapped)`}
        />
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
                      <Link href={`/control/customers/users/${a.user.id}`}>
                        {a.user.name ?? "—"}
                      </Link>
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

      <Panel title="Hardening status" caption="Gated until implemented at auth boundary">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Platform roles are enforced in code. MFA/passkeys, sensitive-action re-authentication, and
          break-glass controls are not exposed here until implemented and audited (see SECURITY.md).
        </p>
      </Panel>
    </>
  );
}
