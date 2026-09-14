import Link from "next/link";
import { desc, eq, gte, sql } from "drizzle-orm";
import { organizations, usageRecords } from "@calder/db";
import { getDb } from "@calder/db";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { emailTotals } from "@/lib/control/queries";
import { Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformUsagePage() {
  await requireSection("platform");
  const db = getDb();
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [totals, metered, byOrg] = await Promise.all([
    emailTotals(30),
    db
      .select({ metric: usageRecords.metric, quantity: sql<number>`sum(${usageRecords.quantity})` })
      .from(usageRecords)
      .where(gte(usageRecords.periodStart, since))
      .groupBy(usageRecords.metric),
    db
      .select({
        org: organizations.name,
        orgId: organizations.id,
        quantity: sql<number>`sum(${usageRecords.quantity})`,
      })
      .from(usageRecords)
      .innerJoin(organizations, eq(usageRecords.organizationId, organizations.id))
      .where(gte(usageRecords.periodStart, since))
      .groupBy(organizations.id, organizations.name)
      .orderBy(desc(sql`sum(${usageRecords.quantity})`))
      .limit(10),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Usage"
        subtitle="Metered consumption across the platform. Billing meters at the canonical accepted-send event — identical for API and SMTP."
      />

      <div className="cp-stats">
        <Stat label="Emails (30d)" value={fmtInt(totals.total)} hint="authoritative record count" />
        <Stat label="Metered (90d)" value={fmtInt(Number(metered.find((m) => m.metric === "emails_sent")?.quantity ?? 0))} hint="usage_records" />
        <Stat
          label="Delivered (90d metered)"
          value={fmtInt(Number(metered.find((m) => m.metric === "emails_delivered")?.quantity ?? 0))}
        />
        <Stat label="Top consumer" value={byOrg[0]?.org ?? "—"} hint={byOrg[0] ? `${fmtInt(Number(byOrg[0].quantity))} metered` : undefined} />
      </div>

      <Panel title="Metered usage by organization" caption="last 90 days · top 10" flush>
        {byOrg.length === 0 ? (
          <Empty title="No metered usage yet">
            Usage records are written by the meter once projects send at volume.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Metered quantity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {byOrg.map((o) => (
                  <tr key={o.orgId}>
                    <td>{o.org}</td>
                    <td className="cp-num">{fmtInt(Number(o.quantity))}</td>
                    <td>
                      <Link href={`/control/customers/organizations/${o.orgId}`}>inspect →</Link>
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
