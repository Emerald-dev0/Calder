import Link from "next/link";
import { fmtDate, fmtInt, fmtMoney } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { subscriptionRows } from "@/lib/control/queries";
import { Badge, Dot, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const TONE: Record<string, "ok" | "warn" | "bad" | "info" | "idle"> = {
  active: "ok",
  trialing: "info",
  past_due: "warn",
  canceled: "idle",
  incomplete: "bad",
};

export default async function SubscriptionsPage() {
  await requireSection("billing");
  const rows = await subscriptionRows(100);
  const active = rows.filter((r) => r.subscription.status === "active");
  const pastDue = rows.filter((r) => r.subscription.status === "past_due");

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Subscriptions"
        subtitle="Every commercial relationship, newest first. Plan changes happen from an organization's page — explicit duration, always audit-logged."
      />

      <div className="cp-stats">
        <Stat label="Active" value={fmtInt(active.length)} />
        <Stat
          label="Past due"
          value={fmtInt(pastDue.length)}
          hint={pastDue.length ? "collection needed" : "clean"}
        />
        <Stat
          label="Latest"
          value={rows[0] ? fmtMoney(Number(rows[0].price ?? 0)) : "—"}
          hint={
            rows[0]
              ? `${rows[0].organization.name} · ${fmtDate(new Date(rows[0].subscription.createdAt))}`
              : undefined
          }
        />
      </div>

      <Panel
        title="All subscriptions"
        caption={`${fmtInt(rows.length)} records · latest 100`}
        flush
      >
        {rows.length === 0 ? (
          <div className="cp-empty">
            <b>No subscriptions yet</b>
            Assign a plan from any organization&rsquo;s page to create the first one.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Period end</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.subscription.id}>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>
                        {r.organization.name}
                      </Link>
                    </td>
                    <td>{r.plan.name}</td>
                    <td className="cp-num">{r.price ? fmtMoney(Number(r.price)) : "—"}</td>
                    <td>
                      <Badge
                        tone={
                          r.subscription.status === "active"
                            ? "ok"
                            : r.subscription.status === "past_due"
                              ? "warn"
                              : undefined
                        }
                      >
                        <Dot
                          tone={
                            (TONE[r.subscription.status] as "ok" | "warn" | "bad" | "idle") ??
                            "idle"
                          }
                        />{" "}
                        {r.subscription.status}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {r.subscription.currentPeriodEnd
                        ? fmtDate(new Date(r.subscription.currentPeriodEnd))
                        : "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtDate(new Date(r.subscription.createdAt))}
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>
                        manage →
                      </Link>
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
