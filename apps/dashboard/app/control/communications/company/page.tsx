import Link from "next/link";
import { and, count, desc, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { companyEmails, emailPreferences, getDb, users } from "@calder/db";
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
import { previewSampleData, resolveCataloguePreview } from "@/lib/control/email-preview";
import {
  DRAFT_BODY_SKELETON,
  DRAFT_LIMITS,
  MERGE_FIELDS,
  PREVIEW_PERSONA,
  draftFromSearchParams,
  renderDraftPreview,
  validateDraft,
} from "@/lib/control/company-draft";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/app/control/_components/ui";
import { sendTestToSelf, sendToProductUsers } from "./actions";

export const dynamic = "force-dynamic";

const SENDABLE = [
  { id: "updates.announcement", label: "Announcement (pricing, launch, sunset)" },
  { id: "updates.product_update", label: "Product update (changelog)" },
] as const;

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  if (!d) return "never";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
}

export default async function CompanyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    sent?: string;
    skipped?: string;
    failed?: string;
    test?: string;
    preview?: string;
    /** `operator` = broadcasts sent from this console; `all` = every company email. */
    scope?: string;
    /** The GET preview step: the operator's own draft, read back from the URL. */
    template?: string;
    title?: string;
    body?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  }>;
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
      at: sql<Date | string>`max(${companyEmails.createdAt})`,
      sent: sql<number>`count(*) filter (where ${companyEmails.status} = 'sent')`,
    })
    .from(companyEmails)
    .groupBy(companyEmails.template);

  const lastSentBy = new Map(lastSent.map((row) => [row.template, row]));

  // Default to the broadcasts this console sent. The newest twelve *company*
  // emails are almost always sign-in notices, which made this table look like
  // the page had nothing to do with the operator's own sends.
  const scope = query.scope === "all" ? "all" : "operator";
  const broadcastTemplates = SENDABLE.map((option) => option.id);
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
    .where(
      scope === "operator"
        ? and(
            inArray(companyEmails.template, broadcastTemplates),
            gte(companyEmails.createdAt, since)
          )
        : undefined
    )
    .orderBy(desc(companyEmails.createdAt))
    .limit(12);

  const readOnly = (READ_ONLY_ROLES as string[]).includes(ctx.role);

  // Who this run would reach. Shown before sending because "mail every verified
  // account" is a number an operator should see, not infer.
  const [audience] = await db
    .select({ verified: count() })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt));

  const selectedTemplate = SENDABLE.some((option) => option.id === query.template)
    ? (query.template as (typeof SENDABLE)[number]["id"])
    : SENDABLE[0].id;

  // The draft preview. The compose form is a GET form, so what is rendered here
  // is exactly what the operator typed — same renderer, same footer — instead of
  // the sample that used to sit under a "I have read the preview" checkbox.
  const draft = draftFromSearchParams(query);
  const draftValidation = draft ? validateDraft(draft) : null;
  const draftPreview =
    draft && draftValidation?.ok ? renderDraftPreview(selectedTemplate, draft) : null;

  // Previewing the catalogue is an operator capability (F-05). The resolver is
  // told we are the Control Plane *after* `requireSection` has run, and refuses
  // an unknown id rather than falling back to something plausible.
  const previewId =
    resolveCataloguePreview({
      id: query.preview ?? "updates.announcement",
      audience: "operator",
    }) ?? "updates.announcement";
  const preview = renderCompanyEmail({
    id: previewId,
    data: previewSampleData(previewId),
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
        title="Write it"
        caption={
          readOnly
            ? "Your role can inspect this page but not send."
            : "Preview the exact email before it goes anywhere. Verified accounts only, capped at 500 per run."
        }
      >
        {readOnly ? (
          <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0 }}>
            Ask a founder or an operator with write access to send.
          </p>
        ) : (
          <form
            method="get"
            style={{ display: "grid", gap: 12, maxWidth: 720 }}
            aria-label="Compose a company email"
          >
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Template
              <select name="template" className="cp-select" defaultValue={selectedTemplate}>
                {SENDABLE.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Title
              <input
                name="title"
                className="cp-input"
                required
                minLength={DRAFT_LIMITS.titleMin}
                maxLength={DRAFT_LIMITS.titleMax}
                defaultValue={draft?.title ?? ""}
                placeholder="What changed, in one line"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Body
              <textarea
                name="body"
                className="cp-input"
                rows={6}
                required
                minLength={DRAFT_LIMITS.bodyMin}
                maxLength={DRAFT_LIMITS.bodyMax}
                defaultValue={draft?.body ?? `${DRAFT_BODY_SKELETON}Something shipped this week.`}
              />
            </label>
            <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: 0 }}>
              Merge fields: {MERGE_FIELDS.map((field) => `{{${field}}}`).join(", ")} — replaced with
              each recipient&apos;s own name, or &quot;there&quot; when the account has none. Any
              other field is refused rather than sent literally.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                Button label (optional)
                <input
                  name="ctaLabel"
                  className="cp-input"
                  maxLength={DRAFT_LIMITS.ctaLabelMax}
                  defaultValue={draft?.ctaLabel ?? ""}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                Button URL (optional)
                <input
                  name="ctaUrl"
                  className="cp-input"
                  type="url"
                  defaultValue={draft?.ctaUrl ?? ""}
                />
              </label>
            </div>
            <div>
              <button type="submit" className="cp-btn primary">
                Preview this draft
              </button>
              <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: "6px 0 0" }}>
                Previewing renders your words through the real template. Nothing is sent until you
                confirm below the preview.
              </p>
            </div>
          </form>
        )}
      </Panel>

      {draft && draftValidation && !draftValidation.ok ? (
        <Panel title="Preview failed" caption="nothing has been sent" flush>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>{draftValidation.error}</p>
          </div>
        </Panel>
      ) : null}

      {draftPreview && draft ? (
        <>
          <Panel
            title="Preview — your draft"
            caption={`rendered with ${PREVIEW_PERSONA.name} as the recipient · subject “${draftPreview.subject}”`}
            flush
          >
            <iframe
              title="Preview of your draft"
              srcDoc={draftPreview.document}
              sandbox=""
              style={{ width: "100%", height: 560, border: 0, background: "#fff" }}
            />
          </Panel>

          <Panel
            title="Send this draft"
            caption={
              readOnly
                ? "Your role can inspect this page but not send."
                : `This mails every verified account — ${Number(audience?.verified ?? 0)} today, hard cap 500 per run. Optional categories are honoured per recipient.`
            }
          >
            {readOnly ? (
              <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0 }}>
                Ask a founder or an operator with write access to send.
              </p>
            ) : (
              <form action={sendToProductUsers} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
                <input type="hidden" name="template" value={selectedTemplate} />
                <input type="hidden" name="title" value={draft.title} />
                <input type="hidden" name="body" value={draft.body} />
                <input type="hidden" name="ctaLabel" value={draft.ctaLabel ?? ""} />
                <input type="hidden" name="ctaUrl" value={draft.ctaUrl ?? ""} />
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                  <input type="checkbox" name="confirm" required />I have read the preview above and
                  understand this mails every verified account.
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" className="cp-btn primary">
                    Send batch
                  </button>
                  <button type="submit" formAction={sendTestToSelf} className="cp-btn">
                    Send test to me
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: 0 }}>
                  A double submit collapses onto the same rows: the batch key is derived from this
                  exact content and the UTC day.
                </p>
              </form>
            )}
          </Panel>
        </>
      ) : null}

      {!draft || !draftValidation?.ok ? (
        <Panel
          title={`Catalogue sample — ${previewId}`}
          caption="A fixed sample of one catalogue template, with stand-in values. This is not your draft."
          flush
        >
          <iframe
            title={`Preview of ${previewId}`}
            srcDoc={preview.document}
            sandbox=""
            style={{ width: "100%", height: 520, border: 0, background: "#fff" }}
          />
        </Panel>
      ) : null}

      <Panel
        title={scope === "all" ? "Recent company mail (everything)" : "Recent broadcasts"}
        caption={
          scope === "all"
            ? "Every company email, newest first — security notices included. Skips are shown too: a skip is an answer, not a gap."
            : "Broadcasts sent from this console in the last 30 days, newest first, skips included."
        }
        flush
        action={
          <Link
            className="cp-btn"
            style={{ fontSize: 12, padding: "3px 10px" }}
            href={`/control/communications/company?scope=${scope === "all" ? "operator" : "all"}`}
          >
            {scope === "all" ? "Show broadcasts only" : "Show all company mail"}
          </Link>
        }
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
              <th>Preview</th>
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
                <td>
                  <a
                    className="cp-btn"
                    style={{ fontSize: 12, padding: "3px 10px" }}
                    href={`/control/communications/company?preview=${encodeURIComponent(id)}`}
                  >
                    Preview
                  </a>
                </td>
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
