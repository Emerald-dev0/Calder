import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtAgo, fmtDate, fmtInt, fmtMoney } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { orgDetail } from "@/lib/control/queries";
import { Badge, Dot, Empty, PageHeader, Panel, Stat, Tag } from "@/control/_components/ui";
import { setSubscription } from "../../actions";

export const dynamic = "force-dynamic";

export default async function OrgDetailPage({ params }: { params: { id: string } }) {
  await requireSection("customers");
  const data = await orgDetail(params.id);
  if (!data) notFound();
  const { org, members, projects, subscriptions, activeSubscription, plan, monthlyCents, usage, audit, transports, emailCount } =
    data;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/control/customers/organizations" style={{ color: "inherit" }}>
              Organizations
            </Link>{" "}
            / {org.slug}
          </>
        }
        title={org.name}
        subtitle={
          <span className="mono" style={{ fontSize: 12.5 }}>
            {org.id} · created {fmtDate(new Date(org.createdAt))}
          </span>
        }
        right={plan ? <Badge tone="accent">{plan.name}</Badge> : <Badge>no active plan</Badge>}
      />

      <div className="cp-stats">
        <Stat label="Plan" value={plan?.name ?? "Free"} hint={activeSubscription && activeSubscription.currentPeriodEnd ? `renews ${fmtDate(new Date(activeSubscription.currentPeriodEnd))}` : "no active subscription"} />
        <Stat label="MRR" value={monthlyCents ? fmtMoney(monthlyCents) : "₦0"} hint="NGN list price" />
        <Stat label="Members" value={fmtInt(members.length)} />
        <Stat label="Projects" value={fmtInt(projects.length)} hint={`${fmtInt(emailCount)} emails all-time`} />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Members" caption="people inside this organization" flush>
          {members.length === 0 ? (
            <Empty title="No members" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Email</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.membership.id}>
                      <td>
                        <Link href={`/control/customers/users/${m.user.id}`}>{m.user.name ?? "—"}</Link>
                      </td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {m.user.email}
                      </td>
                      <td>
                        <Badge tone={m.membership.role === "owner" ? "accent" : undefined}>{m.membership.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Projects & transports" caption="how this customer sends" flush>
          {projects.length === 0 ? (
            <Empty title="No projects yet" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Transports</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const t = transports.filter((tr) => tr.projectId === p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          {p.name}{" "}
                          <span className="mono" style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                            {p.slug}
                          </span>
                        </td>
                        <td>
                          {t.length === 0 ? (
                            <span style={{ color: "var(--cp-faint)" }}>default provider</span>
                          ) : (
                            t.map((tr) => (
                              <span key={tr.id} style={{ marginRight: 6, display: "inline-flex", alignItems: "center", gap: 5 }}>
                                <Dot tone={tr.status === "active" ? "ok" : tr.status === "suspended" ? "warn" : "bad"} />
                                <span className="mono" style={{ fontSize: 12 }}>
                                  {tr.type}
                                </span>
                              </span>
                            ))
                          )}
                        </td>
                        <td style={{ color: "var(--cp-muted)", fontSize: 12.5 }}>
                          {t.find((tr) => tr.isDefault)?.label
                            ? `default: ${t.find((tr) => tr.isDefault)?.label}`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Plan control" caption="founder-only (M6.2) — cancels the active subscription and opens a new one; the reason lands in the audit log">
          <form
            action={async (formData: FormData) => {
              "use server";
              const outcome = await setSubscription(
                org.id,
                String(formData.get("tier") ?? "free"),
                Number(formData.get("months") ?? 1),
                String(formData.get("reason") ?? "")
              );
              if (!outcome.ok) {
                // Form-action failure surfaces via the error boundary with the
                // action's message (founder-only gate or missing reason).
                throw new Error(outcome.error ?? "Plan grant rejected.");
              }
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
          >
            <select className="cp-select" name="tier" defaultValue={plan?.tier ?? "free"} aria-label="Plan tier">
              <option value="free">Free</option>
              <option value="starter">Builder</option>
              <option value="pro">Pro</option>
              <option value="scale">Scale</option>
            </select>
            <input
              className="cp-input"
              type="number"
              name="months"
              min={1}
              max={36}
              defaultValue={6}
              style={{ width: 90 }}
              aria-label="Duration in months"
            />
            <span style={{ color: "var(--cp-faint)", fontSize: 12 }}>months</span>
            <input
              className="cp-input"
              type="text"
              name="reason"
              placeholder="reason (required — audit)"
              required
              minLength={6}
              maxLength={160}
              style={{ minWidth: 220 }}
              aria-label="Reason for this plan grant"
            />
            <button className="cp-btn primary" type="submit">
              Apply plan
            </button>
          </form>
          <p className="cp-panel-caption" style={{ marginTop: 10 }}>
            Subscription history ({subscriptions.length}):{" "}
            {subscriptions.slice(0, 4).map((s) => (
              <span key={s.id} className="mono" style={{ marginRight: 8, fontSize: 12 }}>
                {s.status} · {s.currentPeriodEnd ? fmtDate(new Date(s.currentPeriodEnd)) : "—"}
              </span>
            ))}
          </p>
          <p className="cp-panel-caption">
            Entitlement overrides (+quota, custom deals) are specified in{" "}
            <Link href="/control/billing/entitlements">Billing → Entitlements</Link> and land with the billing
            integration.
          </p>
        </Panel>

        <Panel title="Usage records" caption="metered usage periods" flush>
          {usage.length === 0 ? (
            <Empty title="No metered usage recorded">Usage rows appear once the meter records billing periods.</Empty>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Quantity</th>
                    <th>Period</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr key={u.id}>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {u.metric}
                      </td>
                      <td className="cp-num">{fmtInt(u.quantity)}</td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                        {u.periodStart ? fmtDate(new Date(u.periodStart)) : "—"} →{" "}
                        {u.periodEnd ? fmtDate(new Date(u.periodEnd)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Organization audit trail" caption="recent actions recorded against this org" flush>
        {audit.length === 0 ? (
          <Empty title="Nothing recorded">Plan changes, invites, and operator actions will appear here.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Target</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {a.action}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {a.targetType ?? "—"} {a.targetId ? a.targetId.slice(0, 20) : ""}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(a.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {members[0] ? (
        <p className="cp-caption">
          Tags &amp; internal notes for this organization land with the CRM-lite pass; today the person-level notes live
          on the <Link href={`/control/customers/users/${members[0].user.id}`}>owner&rsquo;s profile</Link>.{" "}
          <Tag>audit-logged</Tag>
        </p>
      ) : null}
    </>
  );
}
