import { getDb } from "@calder/db";
import { getEmailPreferences, listCompanyEmailsForUser } from "@calder/notify";
import { BellRing, Lock, ShieldCheck } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../../components/design-system";
import { getTenantContext } from "../../../../lib/auth";
import { buildCustomerNotificationsView } from "../../../../lib/notifications/customer-view";
import { updateEmailPreference } from "./actions";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Emails from Calder — the customer view.
 *
 * This page deliberately knows nothing about the catalogue. It cannot name a
 * template id, cannot render one, and has no `?preview=` parameter: the whole
 * catalogue, with triggers, facts and previews, lives in the Control Plane
 * behind an operator guard (F-05). What is left is exactly what a customer is
 * entitled to — the categories they can switch off and the record of what we
 * actually sent them.
 */
export default async function NotificationsPage() {
  const ctx = await getTenantContext();
  const db = getDb();
  const [preferences, history] = await Promise.all([
    getEmailPreferences(db, ctx.user.userId),
    listCompanyEmailsForUser(db, ctx.user.userId, 12),
  ]);

  const view = buildCustomerNotificationsView({ preferences, history });

  return (
    <div>
      <DsPageHeader
        icon={<BellRing size={18} />}
        title="Emails from Calder"
        description="What we send you, and the ones you can turn off."
      />

      <div className="ds-card" style={{ marginBottom: 16 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Your preferences</h2>
            <p className="ds-card-subtitle">
              These are the only categories that are optional. Everything else tells you something
              happened to your account, your money or your sending — switching those off is not
              offered, because not knowing is worse.
            </p>
          </div>
        </div>
        <div className="ds-card-body" style={{ display: "grid", gap: 12 }}>
          {view.cards.map((card) => (
            <div
              key={card.category}
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
                <div style={{ fontWeight: 600, fontSize: 14 }}>{card.title}</div>
                <div style={{ color: "var(--color-muted)", fontSize: 13 }}>{card.note}</div>
              </div>
              <form action={updateEmailPreference}>
                <input type="hidden" name="category" value={card.category} />
                <input type="hidden" name="disabled" value={card.disabled ? "0" : "1"} />
                <button
                  type="submit"
                  className={card.disabled ? "ds-btn ds-btn-primary" : "ds-btn"}
                  aria-label={card.disabled ? `Turn on ${card.title}` : `Turn off ${card.title}`}
                >
                  {card.disabled ? "Turn on" : "Turn off"}
                </button>
              </form>
            </div>
          ))}
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
          {view.history.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
              Nothing yet. Account and security mail appears here as it is sent.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 0 }}>
              {view.history.map((row) => (
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
                  <span style={{ color: "var(--color-muted)" }}>{formatDate(row.at)}</span>
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
