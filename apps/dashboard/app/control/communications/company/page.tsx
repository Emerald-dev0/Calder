import Link from "next/link";
import { and, count, desc, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { companyEmails, emailPreferences, getDb, users } from "@calder/db";
import {
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
import {
  AUDIENCE_OPTIONS,
  describeAudience,
  describeSelectedAudience,
  parseAudience,
  parseSelectedAddresses,
  requiresUnverifiedConfirmation,
} from "@/lib/control/audience";
import {
  batchKeyFor,
  mailedUserIds,
  resolveSelectedUsers,
} from "@/lib/control/audience-recipients";
import {
  batchProgress,
  nextRecipients,
  notOperatorTest,
  runSize,
} from "@/lib/control/company-send";
import { companySenders, defaultCompanySender, findCompanySender } from "@/lib/control/senders";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/app/control/_components/ui";
import { PeoplePicker } from "./people-picker";
import { sendTestToSelf, sendToProductUsers } from "./actions";

export const dynamic = "force-dynamic";

/**
 * A broadcast run sends up to `runSize()` recipients, one provider call each.
 * The default function duration is measured in seconds, so the segment asks for
 * the most a run can need rather than discovering the limit mid-batch.
 */
export const maxDuration = 60;

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
    /** `verified` (default), `everyone`, or `selected`, chosen per send. */
    audience?: string;
    /** Addresses ticked in the picker, kept across the preview. */
    selected?: string;
    /** Addresses pasted in the fallback box (people outside the loaded list). */
    selectedText?: string;
    /** Which declared sender this draft goes out as. */
    from?: string;
    /** Set when the batch has already reached everyone in scope. */
    done?: string;
    /** Recipients still to reach after the run that just finished. */
    remaining?: string;
    /** Rows that already existed for this batch: nothing was sent again. */
    replayed?: string;
    /** Set when the named list was too long to carry back in the form. */
    selectedTooLong?: string;
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
    // A note to yourself is not a send to customers, and must not be counted as
    // one — the test-send path marks its rows so this page can exclude them.
    .where(and(gte(companyEmails.createdAt, since), notOperatorTest()));

  const optOuts = await db
    .select({ total: count() })
    .from(emailPreferences)
    .where(sql`jsonb_array_length(${emailPreferences.disabledCategories}) > 0`);

  // "Last sent" must mean accepted by a provider, not "a row exists". The
  // previous shape took max(created_at) over every status, so a template whose
  // only attempts were refused still showed a delivery date beside a total of
  // zero — the page asserting a send that never happened. Evidence is now
  // strictly the accepted subset, and refused/skipped attempts are counted
  // separately so a row can say "tried, never accepted".
  const lastSent = await db
    .select({
      template: companyEmails.template,
      at: sql<
        Date | string | null
      >`max(${companyEmails.createdAt}) filter (where ${companyEmails.status} = 'sent')`,
      sent: sql<number>`count(*) filter (where ${companyEmails.status} = 'sent')`,
      failed: sql<number>`count(*) filter (where ${companyEmails.status} = 'failed')`,
      skipped: sql<number>`count(*) filter (where ${companyEmails.status} = 'skipped')`,
      attempts: count(),
    })
    .from(companyEmails)
    .where(notOperatorTest())
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

  // Who this run would reach, in both directions. "Mail every verified account"
  // is a number an operator should see rather than infer — and so is how many
  // accounts the narrow audience would leave out.
  const [verifiedRow] = await db
    .select({ n: count() })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt));
  const [totalRow] = await db.select({ n: count() }).from(users);
  const verifiedCount = Number(verifiedRow?.n ?? 0);
  const totalCount = Number(totalRow?.n ?? 0);
  // The picker's list, newest first. The cap is stated on the page rather than
  // implied: an operator looking for someone older keeps the paste box.
  const PEOPLE_LIMIT = 1000;
  const pickerPeople = await db
    .select({ email: users.email, name: users.name, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(PEOPLE_LIMIT);
  const people = pickerPeople.map((person) => ({
    email: person.email,
    name: person.name,
    verified: person.emailVerifiedAt !== null,
  }));

  const audienceScope = parseAudience(query.audience);
  const pickedInput = typeof query.selected === "string" ? query.selected : "";
  const pastedInput = typeof query.selectedText === "string" ? query.selectedText : "";
  // Two ways in, one list out: the picker for browsing accounts, the box for
  // anyone outside the loaded window. The server merges the same way.
  const { addresses: selectedAddresses, truncated: selectedTruncated } = parseSelectedAddresses(
    [pickedInput, pastedInput].filter(Boolean).join(",")
  );
  // Resolving the named list on the page is what lets the preview say "4 of 6
  // matched" instead of showing a count the send might refuse.
  const selectedResolution =
    audienceScope === "selected"
      ? await resolveSelectedUsers(db, selectedAddresses)
      : { matched: [], unmatched: [] };
  const selectedIds = selectedResolution.matched.map((row) => row.id);
  const selectedUnverified = selectedResolution.matched.filter((row) => !row.verified).length;
  const audienceCopy =
    audienceScope === "selected"
      ? describeSelectedAudience(
          selectedIds.length,
          selectedUnverified,
          selectedResolution.unmatched.length
        )
      : describeAudience(audienceScope, verifiedCount, totalCount);

  // From. The page resolves the choice through the same allowlist the action
  // enforces, so the preview cannot show an address the send would refuse.
  const senders = companySenders();
  const chosenSender = findCompanySender(query.from) ?? defaultCompanySender();

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

  // What the next press would actually do, computed with the same helpers the
  // action uses: who is in the run, how many of them never confirmed an address,
  // and how many people would still be left afterwards. The previous shape
  // promised a number (all accounts) and then refused if it was over a cap.
  const batch =
    draft && draftValidation?.ok ? batchKeyFor(selectedTemplate, draft.title, draft.body) : null;
  const mailed = batch ? await mailedUserIds(db, batch) : new Set<string>();
  const progress = batch
    ? await batchProgress(db, { scope: audienceScope, selectedIds, mailedIds: mailed })
    : null;
  const upcoming =
    batch && progress && progress.remaining > 0
      ? await nextRecipients(db, {
          scope: audienceScope,
          selectedIds,
          mailedIds: mailed,
          limit: runSize(),
        })
      : [];
  const upcomingUnverified = upcoming.filter((row) => row.emailVerifiedAt === null).length;
  const upcomingAfter = progress ? Math.max(0, progress.remaining - upcoming.length) : 0;

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

  const catalogue = COMPANY_EMAIL_IDS.map((id) => {
    const row = lastSentBy.get(id);
    const sent = Number(row?.sent ?? 0);
    return {
      id,
      definition: companyEmailDefinition(id)!,
      // Only an accepted send counts as evidence.
      evidence: row && sent > 0 ? { ...row, at: row.at as Date | string, sent } : undefined,
      attempts: Number(row?.attempts ?? 0),
      failed: Number(row?.failed ?? 0),
      skipped: Number(row?.skipped ?? 0),
    };
  });

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

      {query.done ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Nothing left to send: everyone in this audience already has this draft, or has opted
              out. Editing the copy starts a new batch — the batch key is derived from the words and
              the UTC day.
            </p>
          </div>
        </div>
      ) : null}
      {query.sent ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Batch finished: <b>{query.sent}</b> sent, <b>{query.skipped}</b> skipped (opt-outs),{" "}
              <b>{query.failed}</b> failed
              {Number(query.replayed ?? 0) > 0 ? (
                <>
                  , <b>{query.replayed}</b> already had it (nothing was re-sent)
                </>
              ) : null}
              . Every row is in <span className="mono">company_emails</span>.
            </p>
            {Number(query.remaining ?? 0) > 0 ? (
              <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>
                <b>{query.remaining}</b> people in this audience have not had it yet. The draft
                below is the same one — press{" "}
                <b>Send the next {Math.min(Number(query.remaining), runSize())}</b>.
              </p>
            ) : null}
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

      {query.selectedTooLong ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>
              That list was too long to carry back in the form. The batch still remembers everyone
              it reached — paste the same names below and press <b>Send</b> to continue where it
              stopped. Nobody is mailed twice.
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
            : `Preview the exact email before it goes anywhere. One press sends to at most ${runSize()} people; a bigger audience continues over several runs, and the page says how many are left.`
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
              From
              <select name="from" className="cp-select" defaultValue={chosenSender.email}>
                {senders.map((sender) => (
                  <option key={sender.email} value={sender.email}>
                    {sender.label}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: 0 }}>
              {senders.length === 1
                ? "One sending address is declared for this deployment (COMPANY_EMAIL_SENDERS), so every company email leaves from it — verification codes included."
                : `${senders.length} sending addresses are declared for this deployment. Replies go to whichever mailbox sits behind the one you pick.`}{" "}
              An address that is not on this list cannot be sent from, by design.
            </p>
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
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              Audience
              <select name="audience" className="cp-select" defaultValue={audienceScope}>
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: 0 }}>
              {audienceCopy}{" "}
              {AUDIENCE_OPTIONS.find((option) => option.value === audienceScope)?.description}
            </p>
            <div style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              People — used only when the audience is “Specific people”
              <PeoplePicker
                people={people}
                selected={selectedAddresses}
                total={totalCount}
                limit={PEOPLE_LIMIT}
                readOnly={readOnly}
              />
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
              …or paste addresses this list does not show
              <textarea
                name="selectedText"
                className="cp-input"
                rows={2}
                defaultValue={pastedInput}
                maxLength={4000}
                placeholder="ada@example.com, grace@example.com"
              />
            </label>
            <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: 0 }}>
              Existing accounts only — an address with no account is refused and named, so this
              console cannot be used to mail strangers.
              {selectedTruncated ? " Only the first 500 addresses were read." : ""}
            </p>
            {audienceScope === "selected" && selectedAddresses.length > 0 ? (
              <div style={{ fontSize: 12, display: "grid", gap: 4 }}>
                <span style={{ color: "var(--cp-muted)" }}>
                  {selectedResolution.matched.length} of {selectedAddresses.length} matched an
                  account
                  {selectedUnverified > 0
                    ? ` · ${selectedUnverified} never confirmed their address`
                    : ""}
                  .
                </span>
                {selectedResolution.unmatched.length > 0 ? (
                  <span style={{ color: "var(--color-warning)" }}>
                    Not accounts: {selectedResolution.unmatched.slice(0, 8).join(", ")}
                    {selectedResolution.unmatched.length > 8
                      ? ` and ${selectedResolution.unmatched.length - 8} more`
                      : ""}
                  </span>
                ) : null}
              </div>
            ) : null}
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
            caption={`from ${chosenSender.label} · rendered with ${PREVIEW_PERSONA.name} as the recipient · subject “${draftPreview.subject}”`}
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
                : `${audienceCopy} One press sends to at most ${runSize()} people; opt-outs are honoured per recipient.`
            }
          >
            {readOnly ? (
              <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0 }}>
                Ask a founder or an operator with write access to send.
              </p>
            ) : query.selectedTooLong && audienceScope === "selected" ? (
              <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0 }}>
                Paste the names again above and preview once more: this page will not guess who you
                meant.
              </p>
            ) : progress && progress.remaining === 0 ? (
              <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0 }}>
                Everyone in this audience already has this draft, or has opted out. Edit the words
                to start a new batch.
              </p>
            ) : (
              <form action={sendToProductUsers} style={{ display: "grid", gap: 12, maxWidth: 720 }}>
                <input type="hidden" name="template" value={selectedTemplate} />
                <input type="hidden" name="title" value={draft.title} />
                <input type="hidden" name="body" value={draft.body} />
                <input type="hidden" name="ctaLabel" value={draft.ctaLabel ?? ""} />
                <input type="hidden" name="ctaUrl" value={draft.ctaUrl ?? ""} />
                <input type="hidden" name="audience" value={audienceScope} />
                <input type="hidden" name="selected" value={pickedInput} />
                <input type="hidden" name="selectedText" value={pastedInput} />
                <input type="hidden" name="from" value={chosenSender.email} />
                <label
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}
                >
                  <input type="checkbox" name="confirm" required style={{ marginTop: 3 }} />I have
                  read the preview above and understand this press mails {upcoming.length}{" "}
                  {upcoming.length === 1 ? "person" : "people"} from {chosenSender.label}
                  {upcomingAfter > 0
                    ? `, and that ${upcomingAfter} more follow with another press`
                    : ""}
                  .
                </label>
                {requiresUnverifiedConfirmation(upcomingUnverified) ? (
                  <label
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      fontSize: 12.5,
                      color: "var(--color-warning)",
                    }}
                  >
                    <input
                      type="checkbox"
                      name="confirmUnverified"
                      required
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      I understand {upcomingUnverified} of these accounts never confirmed their
                      address. Some may not exist, and a bounce is charged to Calder&apos;s sending
                      reputation, not just this run.
                    </span>
                  </label>
                ) : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" className="cp-btn primary">
                    Send to {upcoming.length} {upcoming.length === 1 ? "person" : "people"}
                    {upcomingAfter > 0 ? " now" : ""}
                  </button>
                  <button type="submit" formAction={sendTestToSelf} className="cp-btn">
                    Send test to me
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--cp-muted)", margin: 0 }}>
                  {upcomingAfter > 0
                    ? `${upcomingAfter} people are left after this press: the same draft is kept in the form, so the next press continues exactly where this one stops. `
                    : ""}
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
            {catalogue.map(({ id, definition, evidence, attempts, failed, skipped }) => (
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
                <td>
                  {evidence ? (
                    fmtDate(evidence.at)
                  ) : attempts > 0 ? (
                    <span style={{ color: "var(--color-warning)" }}>never accepted</span>
                  ) : (
                    "never sent"
                  )}
                </td>
                <td>
                  {evidence ? Number(evidence.sent) : 0}
                  {!evidence && attempts > 0 ? (
                    <div className="mono" style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                      {attempts} attempted
                      {failed > 0 ? ` · ${failed} refused` : ""}
                      {skipped > 0 ? ` · ${skipped} skipped` : ""}
                    </div>
                  ) : null}
                </td>
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
        {catalogue.filter((c) => c.evidence).length} have at least one message a provider accepted,
        and {catalogue.filter((c) => !c.evidence && c.attempts > 0).length} have only ever been
        refused or skipped. A catalogue entry is a declaration of intent, not proof of delivery: the
        remaining {catalogue.filter((c) => c.attempts === 0).length} may be gated on a feature, sent
        by a scheduled job outside this console, or simply never triggered.
      </p>
    </>
  );
}
