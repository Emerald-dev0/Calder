import { requireSection } from "@/lib/control/guard";
import { Badge, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/**
 * Campaigns: the transactional/marketing separation, stated as policy.
 * The customer-facing campaign engine is post-MVP (PRD §18); this page is
 * where the rule lives so the team never "temporarily" bulk-sends through
 * the wrong transport.
 */
export default async function CampaignsPage() {
  await requireSection("communications");

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Campaigns & the Gmail rule"
        subtitle="Two fundamentally different communication categories live inside Calder. This page is the contract: what each category is, and which transports may carry it."
      />

      <div className="cp-grid cp-grid-2">
        <Panel title="Transactional" caption="application events, one person at a time">
          <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
            OTP, verification, password reset, receipts, invoices, alerts, notifications. Sent through the API, SMTP,
            SDKs, or a connected Gmail transport — same pipeline, same event lifecycle, same usage meter.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge tone="ok">API</Badge>
            <Badge tone="ok">SMTP</Badge>
            <Badge tone="ok">SDK</Badge>
            <Badge tone="ok">Gmail transport</Badge>
            <Badge tone="ok">Provider infrastructure</Badge>
          </div>
        </Panel>
        <Panel title="Marketing" caption="broadcasts to many, with consent">
          <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
            Newsletters, announcements, launches, onboarding and lifecycle campaigns. Requires audiences, consent,
            unsubscribe, suppression, scheduling, and its own sending reputation — a separate engine from
            transactional, by design.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge tone="warn">Campaign engine</Badge>
            <Badge tone="warn">Dedicated sending infrastructure</Badge>
            <Badge tone="warn">Consent + unsubscribe required</Badge>
          </div>
        </Panel>
      </div>

      <Panel title="The Gmail rule" caption="a personal Gmail is a transactional transport, never a marketing transport">
        <div
          style={{
            border: "1px solid var(--cp-border)",
            borderRadius: 12,
            padding: "18px 20px",
            background: "var(--cp-bg)",
            marginBottom: 14,
          }}
        >
          <p className="mono" style={{ margin: "0 0 10px", fontSize: 13 }}>
            Gmail <Badge tone="ok">● Connected</Badge>
          </p>
          <p style={{ fontSize: 13.5, margin: "0 0 6px" }}>
            <span style={{ color: "var(--cp-ok)" }}>✓</span> Transactional sending — enabled
          </p>
          <p style={{ fontSize: 13.5, margin: 0 }}>
            <span style={{ color: "var(--cp-faint)" }}>—</span> Marketing campaigns — not supported
          </p>
          <p style={{ fontSize: 12.5, color: "var(--cp-muted)", margin: "10px 0 0", maxWidth: "62ch" }}>
            Marketing requires a verified sending domain and Calder&rsquo;s marketing infrastructure. This exact
            message is shown to customers in the product — no one treats someone&rsquo;s personal Gmail as a bulk-mail
            system through Calder.
          </p>
        </div>
        <p style={{ fontSize: 13, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Mechanically: marketing traffic never touches Gmail transports. The campaign engine queues into marketing
          sending infrastructure (verified domains → dedicated provider pools); Gmail is excluded from campaign
          transport resolution at the code level, not just the UI. Enforcement lands with the campaign engine
          (post-MVP); until then the only broadcast path is the internal one —{" "}
          <span className="mono">/v1/admin/waitlist/broadcast</span> — which rides Calder&rsquo;s own verified
          infrastructure, never Gmail.
        </p>
      </Panel>

      <Panel title="Roadmap: the campaign flow" caption="audience → template → sender → preview → test → schedule → send → analytics">
        <div className="cp-planned">
          <b>Customer-facing campaign engine (post-MVP)</b>
          <p>
            Campaign pages with recipients/delivered/opened/clicked/unsubscribed, scheduling, per-campaign analytics,
            and reputation isolation from transactional traffic. Specified in PRD §18 — deliberately not built by
            multiplying a single send.
          </p>
        </div>
      </Panel>
    </>
  );
}
