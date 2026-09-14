import { eq } from "drizzle-orm";
import { waitlistConfirmation } from "@calder/db";
import { getDb } from "@calder/db";
import { fmtDateTime } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { Empty, KV, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireSection("communications");
  const db = getDb();
  const [confirmation] = await db
    .select()
    .from(waitlistConfirmation)
    .where(eq(waitlistConfirmation.id, "internal"))
    .limit(1);

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Templates"
        subtitle="The dynamic templates Calder's own mail runs on. The waitlist confirmation is editable without a deploy — it is infrastructure that talks."
      />

      <Panel title="Waitlist confirmation" caption="sent on every waitlist join · single dynamic row">
        {confirmation ? (
          <>
            <KV k="Subject" v={confirmation.subject} />
            <KV k="Last updated" v={fmtDateTime(new Date(confirmation.updatedAt))} mono />
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--cp-muted)" }}>
                HTML preview source
              </summary>
              <pre
                className="mono"
                style={{
                  background: "var(--cp-bg)",
                  border: "1px solid var(--cp-border)",
                  borderRadius: 10,
                  padding: 14,
                  fontSize: 12,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  marginTop: 10,
                }}
              >
                {confirmation.html.slice(0, 4000)}
              </pre>
            </details>
            <p className="cp-panel-caption" style={{ marginTop: 12 }}>
              Edit without a deploy:
            </p>
            <pre
              className="mono"
              style={{
                background: "var(--cp-bg)",
                border: "1px solid var(--cp-border)",
                borderRadius: 10,
                padding: 14,
                fontSize: 12,
                overflowX: "auto",
              }}
            >
{`curl -X PUT $API_URL/v1/admin/waitlist/confirmation \\
  -H "Authorization: Bearer $ADMIN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"subject":"…","html":"…","text":"…"}'`}
            </pre>
          </>
        ) : (
          <Empty title="Not configured yet">
            The waitlist confirmation falls back to a built-in template until this row is set via the admin API.
          </Empty>
        )}
      </Panel>
    </>
  );
}
