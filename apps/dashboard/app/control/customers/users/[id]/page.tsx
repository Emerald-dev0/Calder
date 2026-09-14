import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDate, fmtDateTime } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { userDetail } from "@/lib/control/queries";
import { CONTROL_ROLE_LABEL } from "@/lib/control/roles";
import { Badge, Empty, KV, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  await requireSection("customers");
  const data = await userDetail(params.id);
  if (!data) notFound();
  const { user, memberships } = data;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/control/customers" style={{ color: "inherit" }}>
              Users
            </Link>{" "}
            / person
          </>
        }
        title={user.name ?? user.email}
        subtitle={
          <span className="mono" style={{ fontSize: 12.5 }}>
            {user.email} · {user.id}
          </span>
        }
        right={
          user.platformRole ? <Badge tone="accent">{CONTROL_ROLE_LABEL[user.platformRole]}</Badge> : undefined
        }
      />

      <div className="cp-grid cp-grid-2">
        <Panel title="Account" caption="core identity record">
          <KV k="User ID" v={user.id} mono />
          <KV k="Email" v={user.email} mono />
          <KV k="Name" v={user.name ?? "—"} />
          <KV k="Handle" v={user.username ? `@${user.username}` : "—"} mono />
          <KV k="Joined" v={fmtDateTime(new Date(user.createdAt))} mono />
          <KV k="Email verified" v={user.emailVerifiedAt ? fmtDate(new Date(user.emailVerifiedAt)) : "no"} mono />
          <KV k="Onboarding" v={user.onboardingState} mono />
          <KV k="Role (profile)" v={user.role ?? "—"} />
          <KV k="Found us via" v={user.referralSource ?? "—"} />
        </Panel>

        <Panel title="Organizations" caption={`${memberships.length} memberships`} flush>
          {memberships.length === 0 ? (
            <Empty title="No organizations">This user hasn&rsquo;t created or joined a workspace.</Empty>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Role</th>
                    <th>Projects</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((m) => (
                    <tr key={m.organization.id}>
                      <td>{m.organization.name}</td>
                      <td>
                        <Badge>{m.membership.role}</Badge>
                      </td>
                      <td className="cp-num">{m.projects?.length ?? "—"}</td>
                      <td>
                        <Link href={`/control/customers/organizations/${m.organization.id}`}>inspect →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Impersonation" caption="view-as-customer — specified, deliberately gated">
        <div className="cp-planned">
          <b>Read-only support sessions</b>
          <p>
            Viewing Calder as this user (read-only, banner + explicit confirmation for any on-behalf action, fully
            audited) is specified in the Control Plane spec. It is intentionally not wired until support workflows
            exist to need it — never a silent &ldquo;login as&rdquo;.
          </p>
        </div>
      </Panel>
    </>
  );
}
