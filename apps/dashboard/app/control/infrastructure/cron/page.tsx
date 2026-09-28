import { desc } from "drizzle-orm";
import { emails } from "@calder/db";
import { getDb } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CronPage() {
  await requireSection("infrastructure");
  // Scheduled sends are the cron-adjacent surface today: jobs that ride
  // delayed queue work (scheduledFor) instead of a wall-clock scheduler.
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
        subtitle="Scheduled work: scheduled sends ride delayed queue jobs today; recurring jobs (digest, retention sweeps) are idempotent by contract."
      />
      <Panel title="Scheduled sends" caption="latest messages with a scheduledFor time" flush>
        {scheduled.filter((s) => s.scheduledFor).length === 0 ? (
          <div className="cp-empty">
            <b>Nothing scheduled</b>
            Scheduled sends (hold delivery until scheduledFor) appear here.
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
      <Panel
        title="Planned: recurring jobs view"
        caption="every cron entry with last-run and duration"
      >
        <Planned
          title="Cron observability"
          bullets={[
            "Job registry: name, schedule, last run, duration, result",
            "Missed-run detection with alerts",
            "Idempotency proof: safe re-run on every entry",
          ]}
        >
          All cron jobs are already contractually idempotent (ARCHITECTURE §6); this surface makes
          their execution visible.
        </Planned>
      </Panel>
    </>
  );
}
