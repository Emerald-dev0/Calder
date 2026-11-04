import { count, desc, gte, sql } from "drizzle-orm";
import { companyEmails, emailPreferences, getDb } from "@calder/db";
import {
  COMPANY_EMAILS,
  COMPANY_EMAIL_IDS,
  companyEmailDefinition,
  isOptionalCategory,
  renderCompanyEmail,
  defaultUrls,
} from "@calder/notify";
import { requireSection } from "@/lib/control/guard";
import { READ_ONLY_ROLES } from "@/lib/control/roles";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/app/control/_components/ui";
import { sendTestToSelf, sendToProductUsers } from "./actions";

export const dynamic = "force-dynamic";

const SENDABLE = [
  { id: "updates.announcement", label: "Announcement (pricing, launch, sunset)" },
  { id: "updates.product_update", label: "Product update (changelog)" },
] as const;

function fmtDate(value: Date | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}

export default async function CompanyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; skipped?: string; failed?: string; test?: string }>;
}) {
  const ctx = await requireSection("communications");
  const query = await searchParams;
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totals] = await db
    .select({
      total: count(),
      sent: sql<number>`count(*) filter (where ${companyEmails.status} = 'sent')`,
      skipped: sql<number>`count(*) filter (where ${companyEmails.status} = 'skipped')`,
      failed: sql<number>`count(*) filter (where ${companyEmails.status} = 'failed')`,
    })
    .from(companyEmails)
    .where(gte(companyEmails.createdAt, since));

  const optOuts = await db
    .select({ total: count() })
    .from(emailPreferences)
    .where(sql`jsonb_array_length(${emailPreferences.disabledCategories}) > 0`);

  const lastSent = await db
    .select({
      template: companyEmails.template,
      at: sql<Date>`max(${companyEmails.createdAt})`,
      sent: sql<number>`count(*) filter (where ${companyEmails.status} = 'sent')`,
    })
    .from(companyEmails)
    .groupBy(companyEmails.template);

  const lastSentBy = new Map(lastSent.map((row) => [row.template, row]));

  const recent = await db
    .select({
      id: companyEmails.id,
      to: companyEmails.toEmail,
      template: companyEmails.template,
      subject: companyEmails.subject,
      status: companyEmails.status,
      skipReason: companyEmails.skipReason,
      createdAt: companyEmails.createdAt,
    })
    .from(companyEmails)
    .orderBy(desc(companyEmails.createdAt))
    .limit(12);

  const readOnly = (READ_ONLY_ROLES as string[]).includes(ctx.role);
  const previewId = "updates.announcement" as const;
  const preview = renderCompanyEmail({
    id: previewId,
    data: {
      title: "A change worth knowing about",
      body: "This is the exact layout an operator send uses. Replace this copy with the real announcement; the footer, the unsubscribe and the reason line stay identical.",
      ctaLabel: "Read the details",
      ctaUrl: "https://calder.click/changelog",
    },
    urls: defaultUrls(),
    preview: true,
  });

  const catalogue = COMPANY_EMAIL_IDS.map((id) => ({
    id,
    definition: companyEmailDefinition(id)!,
    evidence: lastSentBy.get(id),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Company email"
        subtitle="Everything Calder sends to its own users, with the evidence behind it. Customer broadcasts live in the customer dashboard."
        right={
          <Badge tone={readOnly ? "warn" : "ok"}>
            {readOnly ? `${ctx.role} — read only` : ctx.role}
          </Badge>
        }
      />

      {query.sent ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Batch finished: <b>{query.sent}</b> sent, <b>{query.skipped}</b> skipped (opt-outs and
              duplicates), <b>{query.failed}</b> failed. Every row is in{" "}
              <span className="mono">company_emails</span>.
            </p>
          </div>
        </div>
      ) : null}
      {query.test ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Test email sent to {ctx.email}. Check it on a phone before sending to customers.
            </p>
          </div>
        </div>
      ) : null}

      <div className="cp-stats">
        <Stat label="Sent · 30 days" value={Number(totals?.sent ?? 0)} hint="provider accepted" />
        <Stat
          label="Skipped · 30 days"
          value={Number(totals?.skipped ?? 0)}
          hint="opt-outs, duplicates, bad addresses"
        />
        <Stat
          label="Failed · 30 days"
          value={Number(totals?.failed ?? 0)}
          hint="provider refused"
        />
        <Stat
          label="People with opt-outs"
          value={Number(optOuts[0]?.total ?? 0)}
          hint="product news or digest switched off"
        />
      </div>

      <Panel
        title="Send to product users"
        caption={
          readOnly
            ? "Your role can inspect this page but not send."
            : "Verified accounts only, capped at 500 per run. Optional categories are honoured per recipient."
        }
      >
        {readOnly ? (
          <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0 }}>
            Ask a founder or an operator with write access to send.
          </p>
        ) : (
          <form action={sendToProductUsers} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Template
              <select name="template" className="cp-select" defaultValue={SENDABLE[0].id}>
                {SENDABLE.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Title
              <input name="title" className="cp-input" required minLength={3} maxLength={120} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Body
              <textarea name="body" className="cp-input" rows={4} required minLength={20} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                Button label (optional)
                <input name="ctaLabel" className="cp-input" maxLength={40} />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                Button URL (optional)
                <input name="ctaUrl" className="cp-input" type="url" />
              </label>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <input type="checkbox" name="confirm" required />I have read the preview below and
              understand this mails every verified account.
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" className="cp-btn">
                Send batch
              </button>
              <button type="submit" formAction={sendTestToSelf} className="cp-btn">
                Send test to me
              </button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title="Preview — announcement" caption="Sample values, real templates." flush>
        <iframe
          title="Announcement preview"
          srcDoc={preview.document}
          sandbox=""
          style={{ width: "100%", height: 520, border: 0, background: "#fff" }}
        />
      </Panel>

      <Panel
        title="Recent sends"
        caption="Newest first, including skips — a skip is an answer, not a gap."
        flush
      >
        {recent.length === 0 ? (
          <Empty title="No company email yet">
            Nothing has been sent since this database was created.
          </Empty>
        ) : (
          <table className="cp-table">
            <thead>
              <tr>
                <th>To</th>
                <th>Subject</th>
                <th>Template</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.to}</td>
                  <td>{row.subject}</td>
                  <td className="mono">{row.template}</td>
                  <td>
                    <Badge
                      tone={row.status === "sent" ? "ok" : row.status === "failed" ? "bad" : "warn"}
                    >
                      {row.status === "skipped" && row.skipReason
                        ? `skipped · ${row.skipReason}`
                        : row.status}
                    </Badge>
                  </td>
                  <td>{fmtDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title={`Catalogue — ${COMPANY_EMAIL_IDS.length} templates`}
        caption="“Last sent” is evidence from company_emails, not a declaration in code."
        flush
      >
        <table className="cp-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Category</th>
              <th>Audience</th>
              <th>Last sent</th>
              <th>Sent total</th>
            </tr>
          </thead>
          <tbody>
            {catalogue.map(({ id, definition, evidence }) => (
              <tr key={id}>
                <td>
                  <div className="mono" style={{ fontSize: 12 }}>
                    {id}
                  </div>
                  <div style={{ color: "var(--cp-muted)", fontSize: 12 }}>
                    {definition.description}
                  </div>
                </td>
                <td>
                  <Badge tone={isOptionalCategory(definition.category) ? "info" : "warn"}>
                    {definition.category}
                  </Badge>
                </td>
                <td>{definition.audience}</td>
                <td>{evidence ? fmtDate(evidence.at) : "never sent"}</td>
                <td>{evidence ? Number(evidence.sent) : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <p style={{ fontSize: 12, color: "var(--cp-faint)", marginTop: 14 }}>
        {COMPANY_EMAIL_IDS.length} templates in the catalogue ·{" "}
        {Object.keys(COMPANY_EMAILS).filter((id) => lastSentBy.has(id)).length} have real delivery
        history. The rest are either waiting on a feature or are sent by a scheduled job outside
        this console.
      </p>
    </>
  );
}
