import Link from "next/link";
import { fmtAgo, fmtDate, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { triageQueue } from "@/lib/control/queries";
import { ACK_COOLDOWN_HOURS, fingerprintOf } from "@/lib/control/acknowledgements";
import { SEVERITY_LABEL, type TriageItem, type TriageSeverity } from "@/lib/control/triage";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";
import { acknowledgeItem, reopenItem } from "./actions";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER: TriageSeverity[] = ["critical", "high", "normal"];

const SEVERITY_TONE: Record<TriageSeverity, "bad" | "warn" | "info"> = {
  critical: "bad",
  high: "warn",
  normal: "info",
};

const SEVERITY_CAPTION: Record<TriageSeverity, string> = {
  critical: "a customer cannot send, or data is about to be destroyed",
  high: "failing now, and the customer probably does not know",
  normal: "waiting on the customer, or worth a sweep this week",
};

const ACK_NOTICE: Record<string, { tone: "ok" | "warn" | "bad"; text: string }> = {
  saved: {
    tone: "ok",
    text: `Acknowledged. The item stays out of the queue for ${ACK_COOLDOWN_HOURS} hours, or until its evidence changes — whichever comes first.`,
  },
  reopened: { tone: "warn", text: "Reopened. The item is back in the queue where it belongs." },
  already: { tone: "warn", text: "That item is already acknowledged; nothing changed." },
  gone: {
    tone: "ok",
    text: "That item is no longer in the queue — the condition resolved itself before the click.",
  },
  changed: {
    tone: "bad",
    text: "The condition changed while the page was open, so nothing was acknowledged. Read the current row and decide again.",
  },
  missing: { tone: "bad", text: "The request was incomplete, so nothing was recorded." },
};

function AckForm({ item }: { item: TriageItem }) {
  return (
    <form action={acknowledgeItem} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="hidden" name="itemId" value={item.id} />
      {/* Recomputed server-side; this is the claim, not the proof. */}
      <input type="hidden" name="fingerprint" value={fingerprintOf(item)} />
      <input
        className="ds-input"
        name="note"
        placeholder="note (optional)"
        maxLength={1000}
        aria-label={`Note for ${item.title}`}
        style={{ width: 150 }}
      />
      <button className="ds-btn ds-btn-secondary ds-btn-sm" type="submit">
        Seen
      </button>
    </form>
  );
}

/**
 * Support, as a triage queue over state we actually hold — with a memory.
 *
 * The queue is derived on every render, which is what keeps it true. The cost
 * of that purity is that an investigated item has nowhere to go, so the page
 * also reads acknowledgements: append-only records that bind an operator's
 * look to the evidence they looked at, lapse after a day, and reopen the
 * moment the condition changes. Acknowledged rows are still shown, below, with
 * who did it and when it lapses — hidden from the queue, never hidden from
 * the operator.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ack?: string }>;
}) {
  await requireSection("customers");
  const [queue, params] = await Promise.all([triageQueue(), searchParams]);
  const { counts, items, unreadable, checked, acknowledged } = queue;
  const notice = params.ack ? ACK_NOTICE[params.ack] : undefined;
  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    rows: items.filter((i) => i.severity === severity),
  })).filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Support"
        subtitle="Every workspace and record currently in a state that needs a person: sending stopped, a purge about to run, a domain that never verified, a webhook that gave up. Ranked by consequence, each row linked to the record itself."
      />

      {notice ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Badge tone={notice.tone}>{params.ack}</Badge>
            <p style={{ margin: 0, fontSize: 13.5 }}>{notice.text}</p>
          </div>
        </div>
      ) : null}

      <div className="cp-stats">
        <Stat
          label="Critical"
          value={fmtInt(counts.critical)}
          hint="cannot send, or deletion imminent"
        />
        <Stat label="High" value={fmtInt(counts.high)} hint="failing now" />
        <Stat label="Normal" value={fmtInt(counts.normal)} hint="waiting on the customer" />
        <Stat
          label="Acknowledged"
          value={fmtInt(acknowledged.length)}
          hint={`lapses after ${ACK_COOLDOWN_HOURS}h or on new evidence`}
        />
      </div>

      {unreadable.length > 0 ? (
        <Panel
          title="Could not check"
          caption="unknown, not clear — do not read this as “nothing wrong”"
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--cp-muted)" }}>
            These signals failed to load on this render, so the queue below is incomplete:
          </p>
          <ul
            style={{
              margin: "8px 0 0",
              paddingLeft: 18,
              fontSize: 13,
              color: "var(--color-danger)",
            }}
          >
            {unreadable.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--cp-faint)" }}>
            Check the database connection on{" "}
            <Link href="/control/infrastructure/database">Infrastructure → Database</Link> before
            treating the queue as complete.
          </p>
        </Panel>
      ) : null}

      {items.length === 0 ? (
        <Panel
          title="Nothing needs you right now"
          caption={`${fmtInt(checked.length - unreadable.length)} signals read, all quiet`}
        >
          <Empty title="No blocked workspaces, expiring deletions, or failing deliveries">
            An empty queue means these seven checks passed, not that every customer is happy. Mail
            that never arrived, a question about an invoice, or a complaint sent to your inbox has
            no row here — it was never written to the database.
          </Empty>
          <ul
            style={{
              margin: 0,
              padding: "4px 16px 12px 34px",
              fontSize: 12.5,
              color: "var(--cp-muted)",
              lineHeight: 1.7,
            }}
          >
            {checked.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </Panel>
      ) : (
        grouped.map(({ severity, rows }) => (
          <Panel
            key={severity}
            title={`${SEVERITY_LABEL[severity]} · ${fmtInt(rows.length)}`}
            caption={SEVERITY_CAPTION[severity]}
            action={<Badge tone={SEVERITY_TONE[severity]}>{severity}</Badge>}
            flush
          >
            <div style={{ overflowX: "auto" }}>
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Needs attention</th>
                    <th>Customer</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id}>
                      <td style={{ maxWidth: 620 }}>
                        <div style={{ fontWeight: 600 }}>{item.title}</div>
                        <div style={{ fontSize: 12.5, color: "var(--cp-muted)", lineHeight: 1.55 }}>
                          {item.detail}
                        </div>
                      </td>
                      <td>{item.organizationName}</td>
                      <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                        {item.since ? fmtAgo(item.since) : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <Link href={item.href}>Open</Link>
                          <AckForm item={item} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}

      {acknowledged.length > 0 ? (
        <Panel
          title={`Acknowledged · ${fmtInt(acknowledged.length)}`}
          caption={`seen by an operator · returns automatically after ${ACK_COOLDOWN_HOURS}h, or immediately if the evidence changes`}
          flush
        >
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Customer</th>
                  <th>Acknowledged</th>
                  <th>Note</th>
                  <th>Lapses</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {acknowledged.map(({ item, ack, expiresAt }) => (
                  <tr key={item.id}>
                    <td style={{ maxWidth: 460 }}>
                      <div style={{ fontWeight: 600 }}>{item.title}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                        {item.kind} · {item.severity} · evidence unchanged since the look
                      </div>
                    </td>
                    <td>{item.organizationName}</td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {ack.acknowledgedByEmail ?? "an operator"}
                      <div style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                        {fmtAgo(ack.acknowledgedAt)}
                      </div>
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--cp-muted)", maxWidth: 260 }}>
                      {ack.note ?? "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-faint)" }}>
                      {fmtDate(expiresAt)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <form action={reopenItem}>
                        <input type="hidden" name="ackId" value={ack.id} />
                        <button className="ds-btn ds-btn-secondary ds-btn-sm" type="submit">
                          Reopen
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="How this queue is built" caption="stored state only, never a guess">
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--cp-muted)" }}>
          <p style={{ margin: 0 }}>
            Seven signals are read on every load: workspaces paused or suspended, workspaces inside
            their deletion grace window, domains still pending after a day or failed outright,
            webhook deliveries that exhausted every retry in the last week, projects with at least
            three failed or bounced live sends in the last 24 hours, sender identities blocked by
            verification, and transports a provider has revoked.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            “Seen” records a look, bound to the evidence on screen: if the condition changes (a
            pending domain fails, a failure count crosses an order of magnitude, a deletion
            escalates) the item reopens immediately, and every acknowledgement lapses after{" "}
            {ACK_COOLDOWN_HOURS} hours regardless. Nothing is deleted, and both acknowledging and
            reopening are written to the audit log with the operator&apos;s identity.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            For a free-form investigation, use <Link href="/control/customers">Users</Link>,{" "}
            <Link href="/control/customers/organizations">Organizations</Link>,{" "}
            <Link href="/control/customers/domains">Domains</Link>,{" "}
            <Link href="/control/customers/health">Customer health</Link>, and{" "}
            <Link href="/control/platform/deliverability">Deliverability</Link>. Administrative
            actions stay permissioned and audit-logged; nothing on this page changes a customer
            workspace by itself.
          </p>
          <p style={{ margin: "8px 0 0", color: "var(--cp-faint)", fontSize: 12.5 }}>
            Deliberately absent: ticket threads, assignees, and statuses like “waiting on customer”.
            Calder has no ticket table, so inventing one here would create a second, emptier place
            to look — and a row that says “open” without a single message behind it.
          </p>
        </div>
      </Panel>
    </>
  );
}
