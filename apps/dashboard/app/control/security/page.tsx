import Link from "next/link";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  abuseCandidates,
  emailTotals,
  gmailCapUsage,
  gmailWatchEvents,
} from "@/lib/control/queries";
import { reactivateGmailTransport } from "./actions";
import { Badge, BarList, Dot, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/**
 * Abuse surface: the signals that matter for an email platform, plus the
 * response ladder. Enforcement actions (pause sending, suspend org) land
 * with the restrictions system — listed here as the contract, not faked.
 */
export default async function AbusePage() {
  await requireSection("security");
  const [abuse, totals, gmail, watchEvents] = await Promise.all([
    abuseCandidates(7),
    emailTotals(7),
    gmailCapUsage(),
    gmailWatchEvents(16),
  ]);
  const nearCap = gmail.filter((g) => g.sentToday >= (g.dailyCap ?? 400) * 0.8);

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Abuse"
        subtitle="Calder must never become a spam relay. Unusual sending, spam behavior, bounce and complaint spikes — detected here, acted on through the response ladder."
      />

      <div className="cp-stats">
        <Stat
          label="Suspicious senders (7d)"
          value={fmtInt(abuse.suspicious.length)}
          hint="≥10% bounces or any complaint"
        />
        <Stat label="Bounces (7d)" value={fmtInt(totals.bounced)} invertDelta />
        <Stat
          label="Complaints (7d)"
          value={fmtInt(totals.complained)}
          invertDelta
          hint="any is critical"
        />
        <Stat
          label="Restricted transports"
          value={fmtInt(abuse.suspensions)}
          hint="suspended or revoked"
        />
      </div>

      <Panel title="Sender review queue" caption="candidate abusers from the last 7 days" flush>
        {abuse.suspicious.length === 0 ? (
          <div className="cp-empty">
            <b>No suspicious senders</b>
            Every sender is within acceptable bounce/complaint bounds this week.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Sends</th>
                  <th>Bounces</th>
                  <th>Bounce rate</th>
                  <th>Complaints</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {abuse.suspicious.map((s) => (
                  <tr key={s.from}>
                    <td className="mono wrap" style={{ fontSize: 12.5, whiteSpace: "normal" }}>
                      {s.from}
                    </td>
                    <td className="cp-num">{fmtInt(s.sent)}</td>
                    <td className="cp-num">{fmtInt(s.bounced)}</td>
                    <td>
                      <Badge tone={s.bounceRate >= 20 ? "bad" : "warn"}>
                        {fmtPct(s.bounceRate)}
                      </Badge>
                    </td>
                    <td className="cp-num">
                      {s.complained > 0 ? <Badge tone="bad">{s.complained}</Badge> : "0"}
                    </td>
                    <td style={{ color: "var(--cp-muted)" }}>investigate</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="cp-grid cp-grid-2">
        <Panel
          title="Response ladder"
          caption="proportionate escalation, always audited — the steps, not made-up volumes"
        >
          <ol style={{ margin: 0, padding: "12px 16px 14px 34px", display: "grid", gap: 10 }}>
            {[
              {
                step: "Warn the customer",
                detail: "bounce rate ≥ 5% or first complaint — email with guidance, no restriction",
              },
              {
                step: "Rate limit the project",
                detail: "sustained ≥ 5% — cap that project while the customer fixes the list",
              },
              {
                step: "Require verification",
                detail: "suspected purchased/scraped list — proof of consent before further sends",
              },
              {
                step: "Pause sending",
                detail:
                  "complaints continue or verification refused — transports frozen pending review",
              },
              {
                step: "Suspend project / organization",
                detail: "abuse is the product (spam operation) — everything stops, egress locked",
              },
              {
                step: "Restore (with note)",
                detail:
                  "appeal accepted or remediation confirmed — restriction lifted, note on file",
              },
            ].map((r, i) => (
              <li key={r.step} style={{ fontSize: 13.5 }}>
                <b>
                  {i + 1} · {r.step}
                </b>
                <span
                  style={{
                    display: "block",
                    color: "var(--cp-faint)",
                    fontSize: 12.5,
                    marginTop: 2,
                  }}
                >
                  {r.detail}
                </span>
              </li>
            ))}
          </ol>
          <p className="cp-panel-caption" style={{ padding: "4px 16px 0 34px" }}>
            Enforcement actions execute through Security → Restrictions once wired; every step
            writes an audit record with actor, reason, and before/after.
          </p>
        </Panel>
        <Panel
          title="Gmail pressure watch"
          caption="conservative limits by design — Gmail accounts get the tightest caps in the system"
        >
          <BarList
            items={nearCap.map((g) => ({
              label: `${g.label} · ${g.sentToday}/${g.dailyCap ?? 400}`,
              count: g.sentToday,
            }))}
            max={Math.max(1, ...gmail.map((g) => g.dailyCap ?? 400))}
          />
          {nearCap.length === 0 ? (
            <p className="cp-panel-caption" style={{ padding: "10px 16px 0" }}>
              No transport is above 80% of its daily cap.
            </p>
          ) : null}
          <p className="cp-panel-caption" style={{ padding: "10px 16px 0" }}>
            Related: <Link href="/control/platform/deliverability">Deliverability</Link> ·{" "}
            <Link href="/control/security/restrictions">Restrictions</Link>
          </p>
        </Panel>
      </div>

      <Panel
        title="Connected Gmail accounts"
        caption="velocity enforcement (M2.5): hourly warn → hourly limit → suspend; revoked grants auto-marked (M2.4). Suspended rows can be re-activated here — the appeal is the action, and it is audit-logged."
        flush
      >
        {gmail.length === 0 ? (
          <div className="cp-empty">
            <b>No Gmail accounts connected</b>
            When customers send through Gmail OAuth transports they appear here with live velocity.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Org / Project</th>
                  <th>Last hour</th>
                  <th>Today / Cap</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {gmail.map((g) => (
                  <tr key={g.id}>
                    <td className="mono wrap" style={{ fontSize: 12.5, whiteSpace: "normal" }}>
                      {g.label}
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12.5 }}>
                        {g.organizationName} / {g.projectName}
                      </span>
                    </td>
                    <td className="cp-num">{fmtInt(g.sentLastHour)}</td>
                    <td className="cp-num">
                      {fmtInt(g.sentToday)} / {fmtInt(g.dailyCap ?? 400)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          g.status === "active" ? "ok" : g.status === "suspended" ? "warn" : "bad"
                        }
                      >
                        {g.status}
                      </Badge>
                    </td>
                    <td className="cp-num">
                      {g.lastUsedAt ? g.lastUsedAt.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td>
                      {g.status === "suspended" ? (
                        <form action={reactivateGmailTransport.bind(null, g.id)}>
                          <button
                            type="submit"
                            style={{
                              fontSize: 12,
                              padding: "4px 10px",
                              borderRadius: 6,
                              border: "1px solid var(--cp-border, #D4D4D4)",
                              background: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            Reactivate
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Watch audit" caption="recent gmail watch / revocation / appeal actions" flush>
        {watchEvents.length === 0 ? (
          <div className="cp-empty">
            <b>No watch actions yet</b>
            Warn, limit, suspend, revoke and reactivate entries land here from the drain, worker and
            this page.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Transport</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {watchEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="cp-num">
                      {e.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td>
                      <Badge
                        tone={
                          e.action.includes("suspend")
                            ? "warn"
                            : e.action.includes("revoked")
                              ? "bad"
                              : "info"
                        }
                      >
                        {e.action.replace("transport.gmail_", "")}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {e.targetId ?? "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {e.metadata ? JSON.stringify(e.metadata).slice(0, 90) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="cp-caption">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Dot tone="info" /> Suppression list: {fmtInt(abuse.suppressedCount)} addresses protected
          platform-wide.
        </span>
      </p>
    </>
  );
}
