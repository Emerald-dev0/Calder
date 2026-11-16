import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { triageQueue } from "@/lib/control/queries";
import { SEVERITY_LABEL, type TriageItem, type TriageSeverity } from "@/lib/control/triage";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

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

function QueueTable({ items }: { items: TriageItem[] }) {
  return (
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
          {items.map((item) => (
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
              <td>
                <Link href={item.href}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Support, as a triage queue over state we actually hold.
 *
 * There is no ticket table in Calder, and adding one would mean asking an
 * operator to retype what the database already knows. Instead this page reads
 * the seven conditions that genuinely need a human — sending stopped, a purge
 * close, a domain that never verified, a webhook that gave up, a project whose
 * sends are failing, a sender blocked by verification, a transport withdrawn by
 * its provider — ranks them by consequence, and links each to the record.
 *
 * What it deliberately does *not* do: pretend to be a mailbox. Anything a
 * customer told us out-of-band is not here, and this page says so rather than
 * implying the queue is the whole picture.
 */
export default async function SupportPage() {
  await requireSection("customers");
  const queue = await triageQueue();
  const { counts, items, unreadable, checked } = queue;
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

      <div className="cp-stats">
        <Stat
          label="Critical"
          value={fmtInt(counts.critical)}
          hint="cannot send, or deletion imminent"
        />
        <Stat label="High" value={fmtInt(counts.high)} hint="failing now" />
        <Stat label="Normal" value={fmtInt(counts.normal)} hint="waiting on the customer" />
        <Stat
          label="Signals checked"
          value={fmtInt(checked.length - unreadable.length)}
          hint={
            unreadable.length > 0
              ? `${fmtInt(unreadable.length)} could not be read — see below`
              : "all readable"
          }
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
          caption={`${fmtInt(checked.length)} signals read, all quiet`}
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
            <QueueTable items={rows} />
          </Panel>
        ))
      )}

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
            For a free-form investigation, use <Link href="/control/customers">Users</Link>,{" "}
            <Link href="/control/customers/organizations">Organizations</Link>,{" "}
            <Link href="/control/customers/domains">Domains</Link>,{" "}
            <Link href="/control/customers/health">Customer health</Link>, and{" "}
            <Link href="/control/platform/deliverability">Deliverability</Link>. Administrative
            actions stay permissioned and audit-logged; nothing on this page changes state by
            itself.
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
