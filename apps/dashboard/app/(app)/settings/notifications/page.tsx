import { getDb } from "@calder/db";
import {
  COMPANY_EMAILS,
  COMPANY_EMAIL_IDS,
  OPTIONAL_CATEGORY_LIST,
  companyEmailDefinition,
  getEmailPreferences,
  listCompanyEmailsForUser,
  renderCompanyEmail,
  type CompanyEmailCategory,
  type CompanyEmailId,
} from "@calder/notify";
import { BellRing, Lock, Mail, ShieldCheck } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../../components/design-system";
import { getTenantContext } from "../../../../lib/auth";
import { updateEmailPreference } from "./actions";

export const dynamic = "force-dynamic";

const CATEGORY_TITLE: Record<CompanyEmailCategory, string> = {
  account: "Account and sign-in",
  security: "Security",
  billing: "Billing",
  legal: "Legal",
  usage: "Usage and limits",
  operations: "Service and operations",
  updates: "Product news",
  digest: "Monthly recap",
};

const CATEGORY_NOTE: Record<string, string> = {
  account:
    "Codes, receipts of your own actions, invitations. These are how you get into the product.",
  security: "Something changed about how you sign in. Always sent, never optional.",
  billing: "Money moved, or is about to. Mandatory by contract and by law.",
  legal: "A policy changed in a way that affects you.",
  usage: "You are close to a ceiling, or you hit one.",
  operations: "Domains, keys, webhooks, deliverability — the state of your workspace.",
  updates: "What shipped. Optional.",
  digest: "Your month in numbers. Optional.",
};

/**
 * Obvious stand-ins for a preview, derived from the catalogue's `data` list.
 * Deliberately fake: a preview that looks like a real receipt would be worse
 * than one that looks like a form.
 */
function sampleData(id: CompanyEmailId): Record<string, string> {
  const def = companyEmailDefinition(id);
  const out: Record<string, string> = {};
  for (const key of def?.data ?? []) {
    if (/code/i.test(key)) out[key] = "123456";
    else if (/url|link/i.test(key)) out[key] = "https://app.calder.click/settings";
    else if (/amount/i.test(key)) out[key] = "₦5,000";
    else if (/percent/i.test(key)) out[key] = "80";
    else if (/when|date|on$|On$/.test(key)) out[key] = "12 March 2026";
    else if (/name/i.test(key)) out[key] = "Ada Lovelace";
    else if (/email/i.test(key)) out[key] = "ada@example.com";
    else out[key] = "Sample";
  }
  return out;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const db = getDb();
  const preferences = await getEmailPreferences(db, ctx.user.userId);
  const recent = await listCompanyEmailsForUser(db, ctx.user.userId, 12);

  const previewId = (COMPANY_EMAIL_IDS as string[]).includes(query.preview ?? "")
    ? (query.preview as CompanyEmailId)
    : null;
  const preview = previewId
    ? renderCompanyEmail({
        id: previewId,
        data: sampleData(previewId),
        urls: {
          app: "https://calder.click",
          dashboard: "https://app.calder.click",
          preferences: "https://app.calder.click/settings/notifications",
          support: "mailto:support@calder.click",
        },
        preview: true,
      })
    : null;

  const optional = OPTIONAL_CATEGORY_LIST;
  const mandatoryCategories = (Object.keys(CATEGORY_TITLE) as CompanyEmailCategory[]).filter(
    (c) => !optional.includes(c)
  );

  return (
    <div>
      <DsPageHeader
        icon={<BellRing size={18} />}
        title="Emails from Calder"
        description="Every email we send you, what it is for, and the two you can turn off."
      />

      <div className="ds-card" style={{ marginBottom: 16 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Your preferences</h2>
            <p className="ds-card-subtitle">
              Product news and the monthly recap are the only optional emails. Everything else tells
              you something happened to your account, your money or your sending — switching those
              off is not offered, because not knowing is worse.
            </p>
          </div>
        </div>
        <div className="ds-card-body" style={{ display: "grid", gap: 12 }}>
          {optional.map((category) => {
            const disabled = preferences.disabled.includes(category);
            return (
              <div
                key={category}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "14px 16px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{CATEGORY_TITLE[category]}</div>
                  <div style={{ color: "var(--color-muted)", fontSize: 13 }}>
                    {CATEGORY_NOTE[category]}
                  </div>
                </div>
                <form action={updateEmailPreference}>
                  <input type="hidden" name="category" value={category} />
                  <input type="hidden" name="disabled" value={disabled ? "0" : "1"} />
                  <button
                    type="submit"
                    className={disabled ? "ds-btn ds-btn-primary" : "ds-btn"}
                    aria-label={
                      disabled
                        ? `Turn on ${CATEGORY_TITLE[category]}`
                        : `Turn off ${CATEGORY_TITLE[category]}`
                    }
                  >
                    {disabled ? "Turn on" : "Turn off"}
                  </button>
                </form>
              </div>
            );
          })}
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "10px 4px 0",
              color: "var(--color-muted)",
              fontSize: 13,
            }}
          >
            <Lock size={14} />
            <span>
              Account, security, billing, legal, usage and operations emails are always sent.
            </span>
          </div>
        </div>
      </div>

      <div className="ds-card" style={{ marginBottom: 16 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">The complete catalogue</h2>
            <p className="ds-card-subtitle">
              Every email the product can send, the moment it fires, and what it contains.
            </p>
          </div>
          <StatusPill status="verified" label={`${COMPANY_EMAIL_IDS.length} emails`} />
        </div>
        <div className="ds-card-body" style={{ display: "grid", gap: 20 }}>
          {[...mandatoryCategories, ...optional].map((category) => {
            const inCategory = COMPANY_EMAIL_IDS.filter(
              (id) => COMPANY_EMAILS[id].category === category
            );
            if (inCategory.length === 0) return null;
            const locked = !optional.includes(category);
            return (
              <section key={category}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  {locked ? <Lock size={13} /> : <Mail size={13} />}
                  <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
                    {CATEGORY_TITLE[category]}
                  </h3>
                  <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    {locked ? "always sent" : "optional"}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 10px" }}>
                  {CATEGORY_NOTE[category]}
                </p>
                <div style={{ display: "grid", gap: 6 }}>
                  {inCategory.map((id) => {
                    const def = companyEmailDefinition(id);
                    return (
                      <div
                        key={id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 12,
                          alignItems: "baseline",
                          padding: "8px 0",
                          borderTop: "1px solid var(--color-border)",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{def?.description}</div>
                          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                            {def?.trigger}
                            {def?.data.length ? ` · ${def.data.join(", ")}` : ""}
                          </div>
                        </div>
                        <a
                          href={`/settings/notifications?preview=${encodeURIComponent(id)}#preview`}
                          className="ds-btn"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                        >
                          Preview
                        </a>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {preview && previewId && (
        <div className="ds-card" id="preview" style={{ marginBottom: 16 }}>
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Preview: {previewId}</h2>
              <p className="ds-card-subtitle">
                Rendered with obvious stand-ins (123456, ₦5,000, ada@example.com) so the layout is
                real and the contents are unmistakably fake.
              </p>
            </div>
            <a href="/settings/notifications" className="ds-btn">
              Close
            </a>
          </div>
          <div className="ds-card-body">
            <iframe
              title={`Preview of ${previewId}`}
              srcDoc={preview.document}
              sandbox=""
              style={{
                width: "100%",
                height: 640,
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                background: "#F5F4EF",
              }}
            />
          </div>
        </div>
      )}

      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Recently sent to you</h2>
            <p className="ds-card-subtitle">
              Recorded in a log separate from customer mail: this never counts against a plan.
            </p>
          </div>
          <ShieldCheck size={16} />
        </div>
        <div className="ds-card-body">
          {recent.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
              Nothing yet. Account and security mail appears here as it is sent.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 0 }}>
              {recent.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 0",
                    borderTop: "1px solid var(--color-border)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{row.subject}</span>
                  <span style={{ color: "var(--color-muted)" }}>{formatDate(row.createdAt)}</span>
                  <StatusPill status={row.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
