import Link from "next/link";
import { and, count, desc, gte, inArray } from "drizzle-orm";
import { companyEmails, emails, getDb, projects } from "@calder/db";
import { fmtAgo, fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { platformMailTotals } from "@/lib/control/queries";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const ROW_LIMIT = 20;
/** Calder's own product projects — the "we are our own first customer" path. */
const INTERNAL_PROJECT_SLUGS = ["website", "internal", "calder"];

/**
 * Calder's own mail, told in the ledgers it actually lives in.
 *
 * This page used to claim to describe "how Calder's own mail actually
 * performs" while reading only `emails` — the customer ledger — and counting
 * rows it had already capped at twenty ("Recent internal sends: 20"). So the
 * headline was wrong past the twentieth send, and the mail Calder sends to its
 * own users (sign-in links, receipts, announcements) was missing from the one
 * page about Calder's own mail.
 *
 * Both ledgers are now shown, named for what they are: `company_emails` is
 * mail Calder addresses to its users directly, `emails` is mail sent through
 * the product from Calder's own projects — the dogfood path, and the only
 * place where the internal view shares a table with customer numbers.
 */
export default async function InternalDeliveryPage() {
  await requireSection("communications");
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const [mail, internalProjects] = await Promise.all([
    platformMailTotals(WINDOW_DAYS),
    db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(inArray(projects.slug, INTERNAL_PROJECT_SLUGS))
      .limit(5),
  ]);
  const internalIds = internalProjects.map((p) => p.id);

  const [ownMail, ownTotal] = await Promise.all([
    db
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
      .where(gte(companyEmails.createdAt, since))
      .orderBy(desc(companyEmails.createdAt))
      .limit(ROW_LIMIT),
    db.select({ n: count() }).from(companyEmails).where(gte(companyEmails.createdAt, since)),
  ]);

  const [productMail, productTotal] = internalIds.length
    ? await Promise.all([
        db
          .select({
            id: emails.id,
            to: emails.to,
            subject: emails.subject,
            status: emails.status,
            transport: emails.transport,
            createdAt: emails.createdAt,
          })
          .from(emails)
          .where(and(inArray(emails.projectId, internalIds), gte(emails.createdAt, since)))
          .orderBy(desc(emails.createdAt))
          .limit(ROW_LIMIT),
        db
          .select({ n: count() })
          .from(emails)
          .where(and(inArray(emails.projectId, internalIds), gte(emails.createdAt, since))),
      ])
    : [[], [{ n: 0 }]];

  const ownTotalRows = Number(ownTotal[0]?.n ?? 0);
  const productTotalRows = Number(productTotal[0]?.n ?? 0);

  // Skipped rows never reached a provider (opt-out, duplicate, no provider),
  // so they are excluded from the rate rather than counted as failures.
  const attempted = mail.companySent + mail.companyFailed;
  const acceptRate = attempted > 0 ? (mail.companySent / attempted) * 100 : null;

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Delivery"
        subtitle="Calder's own mail, from both ledgers: what the platform sends its users directly, and what it sends through the product as its own first customer."
      />

      <div className="cp-stats">
        <Stat
          label="Calder → users (30d)"
          value={fmtInt(mail.companySent)}
          hint="accepted by the provider"
        />
        <Stat
          label="Refused (30d)"
          value={fmtInt(mail.companyFailed)}
          hint={
            mail.companySkipped > 0
              ? `${fmtInt(mail.companySkipped)} more skipped before sending`
              : "provider said no"
          }
          invertDelta
        />
        <Stat
          label="Accept rate"
          value={acceptRate === null ? "—" : fmtPct(acceptRate)}
          hint={attempted > 0 ? `${fmtInt(attempted)} attempted` : "no attempts in the window"}
        />
        <Stat
          label="Through the product (30d)"
          value={fmtInt(productTotalRows)}
          hint="customer ledger, Calder's own projects"
        />
      </div>

      <Panel
        title="Mail to Calder's users"
        caption={`company_emails · newest ${Math.min(
          ROW_LIMIT,
          ownMail.length
        )} of ${fmtInt(ownTotalRows)} in ${WINDOW_DAYS} days`}
        flush
      >
        {ownMail.length === 0 ? (
          <Empty title="Nothing sent to Calder's users in this window">
            Sign-in links, receipts and announcements appear here as they are attempted. A skipped
            row is kept too — an opt-out is a delivery decision worth seeing.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>To</th>
                  <th>Template</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {ownMail.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {e.to}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {e.template}
                    </td>
                    <td className="wrap" style={{ whiteSpace: "normal" }}>
                      {e.subject}
                    </td>
                    <td>
                      <Badge
                        tone={
                          e.status === "sent"
                            ? "ok"
                            : e.status === "failed"
                              ? "bad"
                              : e.status === "skipped"
                                ? "warn"
                                : undefined
                        }
                      >
                        {e.status === "skipped" && e.skipReason
                          ? `skipped · ${e.skipReason}`
                          : e.status}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(e.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Mail sent through the product"
        caption={
          internalIds.length === 0
            ? "no Calder-owned project matched the internal slugs"
            : `emails · newest ${Math.min(
                ROW_LIMIT,
                productMail.length
              )} of ${fmtInt(productTotalRows)} in ${WINDOW_DAYS} days · ${internalProjects
                .map((p) => p.slug)
                .join(", ")}`
        }
        flush
      >
        {productMail.length === 0 ? (
          <Empty title="No product sends from Calder's own projects">
            {internalIds.length === 0
              ? `No project on this deployment uses the slugs ${INTERNAL_PROJECT_SLUGS.join(
                  ", "
                )}, so the dogfood view has nothing to read. It is not zero traffic — it is an unmatched search.`
              : "Join the waitlist on the marketing site, or send through the API with an internal project key, to exercise the same pipeline customers use."}
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Transport</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {productMail.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {e.to}
                    </td>
                    <td className="wrap" style={{ whiteSpace: "normal" }}>
                      {e.subject}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {e.transport ?? "—"}
                    </td>
                    <td>
                      <Badge
                        tone={
                          e.status === "delivered"
                            ? "ok"
                            : e.status === "queued" || e.status === "sent" || e.status === "sending"
                              ? undefined
                              : "bad"
                        }
                      >
                        {e.status}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(e.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="cp-caption">
        These are two separate tables on purpose: a password reset must never appear in a
        customer&apos;s message log or their quota. Totals across both ledgers live in{" "}
        <Link href="/control/platform">Platform → Email</Link>; customer deliverability lives in{" "}
        <Link href="/control/platform/deliverability">Platform → Deliverability</Link>.
      </p>
    </>
  );
}
