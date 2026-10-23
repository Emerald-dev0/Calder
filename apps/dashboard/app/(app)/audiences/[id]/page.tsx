import Link from "next/link";
import { notFound } from "next/navigation";
import { Users, Upload, UserPlus, ArrowLeft } from "lucide-react";
import { getDb } from "@calder/db";
import {
  audienceStats,
  getAudience,
  listAudienceContacts,
  searchAudienceContacts,
} from "@calder/audiences";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { DsPageHeader, StatCard, StatusPill } from "../../../../components/design-system";
import { addContactsAction, importCsvAction } from "../actions";

export const metadata = { title: "Calder — Audience" };

export default async function AudienceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string; q?: string; status?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  if (!scope) notFound();

  const db = getDb();
  const audience = await getAudience(db, scope.project.id, id);
  if (!audience) notFound();

  const stats = await audienceStats(db, audience.id);
  const status =
    query.status === "subscribed" ||
    query.status === "unsubscribed" ||
    query.status === "pending_confirmation"
      ? query.status
      : undefined;
  const rows = query.q
    ? await searchAudienceContacts(db, audience.id, query.q, 100)
    : (await listAudienceContacts(db, audience.id, { limit: 100, status })).data;
  // Both queries return the same fields; normalising once keeps the render
  // path free of union-property narrowing.
  const contacts = rows.map((row) => ({
    contactId: row.contactId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
  }));

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link
          href={`/audiences?project=${scope.project.id}`}
          className="ds-btn"
          style={{ fontSize: 12, textDecoration: "none" }}
        >
          <ArrowLeft size={12} />
          <span>All audiences</span>
        </Link>
      </div>

      <DsPageHeader
        icon={<Users size={18} />}
        title={audience.name}
        description={
          audience.description ??
          "Contacts in this list. Unsubscribes are recorded against the person, not just this list."
        }
        badge={
          <StatusPill
            status="active"
            label={audience.doubleOptIn ? "Double opt-in" : "Single opt-in"}
          />
        }
      />

      <div className="ds-stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Subscribed" value={stats.subscribed} sub="mailable right now" />
        <StatCard
          label="Unsubscribed"
          value={stats.unsubscribed}
          sub="kept for history, never mailed"
        />
        <StatCard
          label="Pending"
          value={stats.pendingConfirmation}
          sub="waiting for confirmation"
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          marginBottom: 20,
        }}
      >
        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">
                <UserPlus size={14} /> Add contacts
              </h2>
              <p className="ds-card-subtitle">
                Paste addresses separated by commas, spaces or new lines.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            <form action={addContactsAction} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="projectId" value={scope.project.id} />
              <input type="hidden" name="audienceId" value={audience.id} />
              <textarea
                name="emails"
                required
                rows={5}
                className="ds-input"
                placeholder="ada@example.com, grace@example.com"
                aria-label="Email addresses"
              />
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <input type="checkbox" name="consentConfirmed" required style={{ marginTop: 3 }} />
                <span>
                  These people gave me permission to email them. Importing a purchased or scraped
                  list is a breach of the terms and gets the workspace suspended.
                </span>
              </label>
              <button type="submit" className="ds-btn ds-btn-primary">
                <UserPlus size={14} />
                <span>Add contacts</span>
              </button>
            </form>
          </div>
        </div>

        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">
                <Upload size={14} /> Import CSV
              </h2>
              <p className="ds-card-subtitle">
                Header row optional. Recognised: email, first name, last name. Other columns become
                contact properties.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            <form action={importCsvAction} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="projectId" value={scope.project.id} />
              <input type="hidden" name="audienceId" value={audience.id} />
              <textarea
                name="csv"
                required
                rows={8}
                className="ds-input"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                }}
                placeholder={"email,first name,last name\nada@example.com,Ada,Lovelace"}
                aria-label="CSV contents"
              />
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                <input type="checkbox" name="consentConfirmed" required style={{ marginTop: 3 }} />
                <span>I have permission to email every address in this file.</span>
              </label>
              <button type="submit" className="ds-btn">
                <Upload size={14} />
                <span>Import</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Contacts ({stats.total.toLocaleString("en-US")})</h2>
            <p className="ds-card-subtitle">Showing up to 100. Search matches the email address.</p>
          </div>
          <form method="get" style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="project" value={scope.project.id} />
            <input
              name="q"
              defaultValue={query.q ?? ""}
              placeholder="Search email"
              aria-label="Search contacts"
              className="ds-input"
              style={{ width: 200 }}
            />
            <button type="submit" className="ds-btn">
              Search
            </button>
          </form>
        </div>
        <div className="ds-card-body">
          {contacts.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>No contacts yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 0 }}>
              {contacts.map((contact) => (
                <div
                  key={contact.contactId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 0",
                    borderTop: "1px solid var(--color-border)",
                    fontSize: 13,
                  }}
                >
                  <span>
                    <strong style={{ fontWeight: 600 }}>
                      {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                        contact.email}
                    </strong>
                    {contact.firstName || contact.lastName ? (
                      <span style={{ color: "var(--color-muted)" }}> · {contact.email}</span>
                    ) : null}
                  </span>
                  <StatusPill status={contact.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
