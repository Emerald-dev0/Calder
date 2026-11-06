import { desc } from "drizzle-orm";
import { emails } from "@calder/db";
import { getDb } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CronPage() {
  await requireSection("infrastructure");
  // Scheduled sends are the durable scheduled-work signal currently available.
  const db = getDb();
  const scheduled = await db
    .select({
      id: emails.id,
      scheduledFor: emails.scheduledFor,
      status: emails.status,
      subject: emails.subject,
    })
    .from(emails)
    .orderBy(desc(emails.scheduledFor))
    .limit(10);

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Cron"
        subtitle="Durable scheduled-send records are shown. A full recurring-job registry is gated until job runs are stored and queryable."
      />
      <Panel title="Scheduled sends" caption="Latest messages with scheduledFor" flush>
        {scheduled.filter((s) => s.scheduledFor).length === 0 ? (
          <div className="cp-empty">
            <b>Nothing scheduled</b>
            Scheduled sends appear here when present.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Scheduled for</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {scheduled
                  .filter((s) => s.scheduledFor)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{s.subject}</td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {new Date(s.scheduledFor as Date)
                          .toISOString()
                          .slice(0, 16)
                          .replace("T", " ")}
                      </td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {s.status}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Gated capability" caption="Recurring job observability">
        <Planned
          state="gated"
          title="Cron/job registry"
          bullets={[
            "Job registry with schedule, last run, duration, and result",
            "Missed-run detection from real execution records",
            "Alert integration for failed or stale jobs",
          ]}
        >
          Recurring job visibility remains gated until execution records are durable.
        </Planned>
      </Panel>
    </>
  );
}
