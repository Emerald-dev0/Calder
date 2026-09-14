import Link from "next/link";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { systemAudiences, waitlistOverview } from "@/lib/control/queries";
import { getConfig } from "@calder/config";
import { Badge, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CommunicationsPage() {
  await requireSection("communications");
  const [audiences, waitlist] = await Promise.all([systemAudiences(), waitlistOverview()]);
  const config = getConfig();
  const broadcastReady = Boolean(config.ADMIN_API_KEY);

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Broadcasts"
        subtitle="Calder emailing its own people — waitlist updates, founder notes, launch announcements. Internal sends ride the same pipeline customers use, with signed one-click unsubscribe."
      />

      <div className="cp-stats">
        <Stat label="Waitlist audience" value={fmtInt(waitlist.total)} hint="all confirmed signups" />
        <Stat label="Invited" value={fmtInt(waitlist.invited)} hint="status: invited" />
        <Stat label="Converted" value={fmtInt(waitlist.converted)} hint="have Calder accounts" />
        <Stat
          label="Broadcast capability"
          value={broadcastReady ? "Ready" : "Needs key"}
          hint={broadcastReady ? "ADMIN_API_KEY configured" : "set ADMIN_API_KEY to enable /v1/admin broadcasts"}
        />
      </div>

      <Panel title="Send a broadcast" caption="CLI-first: broadcasts run through the API pipeline, auditable and replay-safe">
        <p style={{ fontSize: 13.5, margin: "0 0 10px", color: "var(--cp-muted)" }}>
          Every recipient gets a signed one-click unsubscribe (RFC 8058) and a per-recipient idempotency key — re-running
          a campaign replays safely instead of doubling. Suppressed addresses are skipped automatically.
        </p>
        <pre
          className="mono"
          style={{
            background: "var(--cp-bg)",
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
            padding: "14px 16px",
            fontSize: 12,
            overflowX: "auto",
            margin: "0 0 10px",
          }}
        >
{`curl -X POST ${config.API_URL}/v1/admin/waitlist/broadcast \\
  -H "Authorization: Bearer $ADMIN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"campaign":"founder-intro","from":"daniel@calder.click"}'`}
        </pre>
        <p className="cp-panel-caption">
          Named campaigns available today: <code>founder-intro</code>, <code>waitlist-update-001</code>. Custom
          subject/html/text is accepted for one-off sends. Audiences below define who you can reach; campaign-level
          segmentation (per-audience sends) lands with the marketing surface.
        </p>
      </Panel>

      <Panel
        title="System audiences"
        caption="generated live from platform state — the people you can actually reach"
        action={
          <Link className="cp-btn" href="/control/communications/audiences">
            All audiences
          </Link>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 10,
          }}
        >
          {audiences.slice(0, 8).map((a) => (
            <Link
              key={a.key}
              href={a.href}
              style={{
                border: "1px solid var(--cp-border)",
                borderRadius: 10,
                padding: "12px 14px",
                textDecoration: "none",
                background: "var(--cp-panel-2)",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtInt(a.count)}</div>
              <div style={{ fontSize: 12.5, color: "var(--cp-muted)", marginTop: 2 }}>{a.label}</div>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="Marketing, deliberately separated" caption="architecture, not a UI preference">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          <Badge tone="accent">Transactional</Badge> and <Badge tone="warn">Marketing</Badge> are different systems with
          different reputation pools, queues, consent, and transport rules. Gmail-connected accounts can send
          transactional mail — never campaigns. The full rule:{" "}
          <Link href="/control/communications/campaigns">Campaigns &amp; the Gmail rule →</Link>
        </p>
      </Panel>
    </>
  );
}
