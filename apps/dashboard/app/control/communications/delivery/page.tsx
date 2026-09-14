import { and, desc, gte, inArray } from "drizzle-orm";
import { emails, projects } from "@calder/db";
import { getDb } from "@calder/db";
import { fmtAgo, fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { emailTotals } from "@/lib/control/queries";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/**
 * Internal communications delivery: Calder's own mail (waitlist confirmations,
 * broadcasts) tracked as the platform's first customer — the dogfood view.
 */
export default async function InternalDeliveryPage() {
  await requireSection("communications");
  const db = getDb();
  const since30 = new Date(Date.now() - 30 * 86_400_000);

  const internalProjects = await db
    .select({ project: projects })
    .from(projects)
    .where(inArray(projects.slug, ["website", "internal", "calder"]))
    .limit(5);
  const internalIds = internalProjects.map((p) => p.project.id);

  const recent = internalIds.length
    ? await db
        .select({
          id: emails.id,
          to: emails.to,
          subject: emails.subject,
          status: emails.status,
          transport: emails.transport,
          createdAt: emails.createdAt,
        })
        .from(emails)
        .where(and(inArray(emails.projectId, internalIds), gte(emails.createdAt, since30)))
        .orderBy(desc(emails.createdAt))
        .limit(20)
    : [];

  const totals = await emailTotals(30);
  const sentFromInternal = recent.length;

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Delivery"
        subtitle="How Calder's own mail actually performs. The platform's first customer is Calder — every waitlist confirmation and broadcast proves the pipeline."
      />

      <div className="cp-stats">
        <Stat label="Internal projects" value={fmtInt(internalIds.length)} hint="website / internal senders" />
        <Stat label="Recent internal sends" value={fmtInt(sentFromInternal)} hint="last 30 days, newest 20 shown" />
        <Stat
          label="Platform delivery rate"
          value={totals.deliveryRate === null ? "—" : fmtPct(totals.deliveryRate)}
          hint="all traffic, 30 days"
        />
        <Stat label="Bounces + complaints (30d)" value={fmtInt(totals.bounced + totals.complained)} hint="reputation-sensitive events" />
      </div>

      <Panel title="Recent internal mail" caption="waitlist confirmations and broadcasts" flush>
        {recent.length === 0 ? (
          <Empty title="No internal sends on record yet">
            Join the waitlist on the marketing site or trigger a broadcast to exercise the pipeline.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Transport</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {e.to}
                    </td>
                    <td className="wrap" style={{ whiteSpace: "normal" }}>
                      {e.subject}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {e.transport ?? "—"}
                    </td>
                    <td>
                      <Badge tone={e.status === "delivered" ? "ok" : e.status === "queued" || e.status === "sent" || e.status === "sending" ? undefined : "bad"}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(e.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="cp-caption">
        Full-platform delivery analytics live in <span className="mono">Platform → Email</span> and{" "}
        <span className="mono">Platform → Deliverability</span>.
      </p>
    </>
  );
}
