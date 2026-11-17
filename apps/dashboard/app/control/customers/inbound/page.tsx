import Link from "next/link";
import { fmtAgo, fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { inboundOverview } from "@/lib/control/queries";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

const DOMAIN_TONE: Record<string, "ok" | "warn" | "bad" | "info"> = {
  verified: "ok",
  pending: "warn",
  verifying: "info",
  failed: "bad",
  disabled: "warn",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info"> = {
  routed: "ok",
  parsed: "warn",
  received: "info",
  failed: "bad",
  rejected: "warn",
};

/**
 * Inbound, in the Control Plane at last.
 *
 * Sending has had pages since the first milestone; receiving had none, so a
 * broken MX record, an unprovisioned SES receipt rule or a parser regression
 * first showed up as a customer asking why nobody answers their replies. This
 * page answers the two questions separately, because they fail separately:
 *
 *   are we *allowed* to receive for these domains (TXT proof + MX), and
 *   is the mail we receive actually being *processed* (parse failures, mail
 *   that reached us and then went nowhere).
 *
 * A third state matters and is easy to miss: a domain whose DNS is verified but
 * whose receipt rule was never provisioned. DNS says yes, SES still refuses to
 * deliver it to us, and nothing else in the product says so — hence the warning
 * panel below rather than burying `provisioned_at` in a column.
 */
export default async function InboundPage() {
  await requireSection("customers");
  const inbound = await inboundOverview(WINDOW_DAYS);
  const { counts, domains, domainRows } = inbound;

  const verifiedNotProvisioned = domainRows.filter(
    (d) => d.status === "verified" && !d.provisionedAt
  );

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Inbound"
        subtitle="Mail arriving: which domains are proven for receiving, whether the rule that delivers it to us exists, and what happened to the messages that came in."
      />

      <div className="cp-stats">
        <Stat
          label={`Received (${WINDOW_DAYS}d)`}
          value={fmtInt(inbound.total)}
          hint={`${fmtInt(counts.routed)} routed · ${fmtInt(counts.parsed)} parsed`}
        />
        <Stat
          label="Parse failures"
          value={inbound.parseFailureRate === null ? "—" : fmtPct(inbound.parseFailureRate)}
          hint={
            inbound.parseFailureRate === null
              ? "nothing processed in the window"
              : `${fmtInt(counts.failed)} of ${fmtInt(
                  counts.parsed + counts.routed + counts.failed
                )} processed`
          }
          invertDelta
        />
        <Stat
          label="Unrouted"
          value={fmtInt(inbound.unrouted)}
          hint="parsed, matched no inbox rule"
        />
        <Stat
          label="Receiving domains"
          value={`${fmtInt(domains.verified)} / ${fmtInt(domains.total)}`}
          hint={`${fmtInt(inbound.inboxes)} inboxes`}
        />
      </div>

      {verifiedNotProvisioned.length > 0 ? (
        <Panel
          title="Verified but not provisioned"
          caption="DNS says yes, SES still has no rule to deliver it — this mail is being refused before we see it"
        >
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
            {verifiedNotProvisioned.map((d) => (
              <li key={d.id}>
                <span className="mono">{d.domain}</span> · {d.organizationName} · {d.projectName} —
                ownership proven {d.lastCheckedAt ? fmtAgo(d.lastCheckedAt) : "at some point"},
                receipt rule never recorded.
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--cp-faint)" }}>
            Provisioning is an infrastructure step recorded on the domain row (
            <span className="mono">ses_rule_set_name</span> /{" "}
            <span className="mono">ses_rule_name</span>); this page reports the gap rather than
            hiding it behind a green verified badge.
          </p>
        </Panel>
      ) : null}

      <Panel
        title="Receiving domains"
        caption={`${fmtInt(domainRows.length)} shown · counts above cover every domain`}
        flush
      >
        {domainRows.length === 0 ? (
          <Empty title="No receiving domains yet">
            A customer creates one when they want replies to a domain handled by Calder. Nothing is
            accepted for a domain that is not configured here — the MX record points at us only
            after they add it.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>MX seen</th>
                  <th>Checked</th>
                  <th>Workspace</th>
                </tr>
              </thead>
              <tbody>
                {domainRows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.domain}
                      {d.lastError ? (
                        <div
                          title={d.lastError}
                          style={{
                            fontSize: 11.5,
                            color: "var(--color-danger)",
                            maxWidth: 320,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {d.lastError}
                        </div>
                      ) : null}
                      {d.status === "verified" && !d.provisionedAt ? (
                        <div style={{ fontSize: 11.5, color: "var(--color-warning)" }}>
                          no receipt rule recorded
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={DOMAIN_TONE[d.status] ?? "info"}>{d.status}</Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {d.observedMx && d.observedMx.length > 0
                        ? d.observedMx.map((m) => `${m.exchange} · ${m.priority}`).join(", ")
                        : `expected ${d.mxHost} · ${d.mxPriority}`}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {d.lastCheckedAt ? fmtAgo(d.lastCheckedAt) : "never"}
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${d.organizationId}`}>
                        {d.organizationName}
                      </Link>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--cp-faint)" }}>
                        {d.projectName}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Recent inbound"
        caption={`newest ${Math.min(25, inbound.recent.length)} · last ${WINDOW_DAYS} days and before`}
        flush
      >
        {inbound.recent.length === 0 ? (
          <Empty title="No mail received yet">
            Messages appear here as soon as SES hands one to us — before parsing, so a message that
            fails to parse is still visible rather than absent.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>From</th>
                  <th>Subject</th>
                  <th>For</th>
                  <th>Status</th>
                  <th>Inbox</th>
                </tr>
              </thead>
              <tbody>
                {inbound.recent.map((m) => (
                  <tr key={m.id}>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(m.receivedAt)}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {m.fromAddress ?? "—"}
                    </td>
                    <td style={{ maxWidth: 320, whiteSpace: "normal" }}>{m.subject ?? "(none)"}</td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {m.recipientDomain}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[m.status] ?? "info"}>{m.status}</Badge>
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {m.inboxName ?? "unrouted"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {inbound.failures.length > 0 ? (
        <Panel
          title={`Parse failures · ${fmtInt(counts.failed)}`}
          caption={`newest ${Math.min(25, inbound.failures.length)} · each one is mail a customer expected to see`}
          flush
        >
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>From</th>
                  <th>Subject</th>
                  <th>Reason</th>
                  <th>Workspace</th>
                </tr>
              </thead>
              <tbody>
                {inbound.failures.map((m) => (
                  <tr key={m.id}>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(m.receivedAt)}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {m.fromAddress ?? "—"}
                    </td>
                    <td style={{ maxWidth: 280, whiteSpace: "normal" }}>{m.subject ?? "(none)"}</td>
                    <td
                      style={{ maxWidth: 320, whiteSpace: "normal", color: "var(--color-danger)" }}
                    >
                      {m.failureReason ?? "no reason recorded"}
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${m.organizationId}`}>
                        {m.organizationName}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel title="What this page can and cannot see" caption="stored rows only">
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--cp-muted)" }}>
          <p style={{ margin: 0 }}>
            Every figure above is a row: receiving domains and their last DNS check, inbound
            messages and their processing state, inboxes that exist. Rejections are recorded with
            their reason and never counted as parse failures — refusing mail on purpose is a policy
            decision, and mixing the two would make a working filter look like a broken parser.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            Not visible here: mail that never reached us. If a customer&apos;s MX record points
            somewhere else, or their provider refuses a sender upstream, nothing is written to this
            database — absence of rows is not evidence that nothing was sent. Delivery of an
            individual reply is in the customer&apos;s own inbox; the outbound side is in{" "}
            <Link href="/control/platform">Platform → Email</Link>.
          </p>
          <p style={{ margin: "8px 0 0", color: "var(--cp-faint)", fontSize: 12.5 }}>
            Deliberately absent: message bodies and attachments. They belong to the customer, they
            are not needed to answer &ldquo;is receiving working?&rdquo;, and reading a
            customer&apos;s mail to do support is a decision that deserves its own consent, not a
            side effect of a status page.
          </p>
        </div>
      </Panel>
    </>
  );
}
