import { desc, inArray } from "drizzle-orm";
import { getDb, templates } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import Link from "next/link";
import { FileCode2, Plus, ArrowRight, Sparkles } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
  CopyableMono,
} from "../../../components/design-system";

export const metadata = { title: "Calder — Templates" };

export default async function TemplatesPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <DsPageHeader
          icon={<FileCode2 size={18} />}
          title="Templates"
          description="Reusable transactional email templates with version history and variable substitution."
        />
        <EmptyState
          title="No project yet"
          description="Create a project and templates will appear here."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(templates)
    .where(inArray(templates.projectId, projectIds))
    .orderBy(desc(templates.createdAt))
    .limit(20);

  return (
    <div>
      <DsPageHeader
        icon={<FileCode2 size={18} />}
        title="Templates"
        badge={
          <StatusPill
            status="active"
            label={`${rows.length} ${rows.length === 1 ? "template" : "templates"}`}
          />
        }
        description="Versioned HTML and plain-text email templates with {{variable}} injection, sandboxed preview, and one-click test sends."
        actions={
          <Link
            href="/templates/new"
            className="ds-btn ds-btn-primary"
            style={{ textDecoration: "none" }}
          >
            <Plus size={14} />
            <span>Create template</span>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <>
          <EmptyState
            icon={<FileCode2 size={22} />}
            title="No templates yet"
            description="Create reusable email templates for welcome emails, OTPs, password resets, and receipts. Variables, live preview, and test send included."
            actionLabel="Create template"
            actionHref="/templates/new"
          />

          <div className="ds-card" style={{ marginTop: 16 }}>
            <div className="ds-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={15} style={{ color: "var(--color-accent)" }} />
                <div>
                  <h2 className="ds-card-title">Starter Blueprints</h2>
                  <p className="ds-card-subtitle">
                    Jump into the Template Studio with pre-built transactional layouts
                  </p>
                </div>
              </div>
            </div>
            <div className="ds-card-body">
              <div className="ds-grid-3">
                {[
                  {
                    title: "OTP & Magic Link",
                    alias: "auth-otp-code",
                    desc: "High-deliverability authentication code layout with 10-minute expiry notice.",
                  },
                  {
                    title: "Password Reset",
                    alias: "password-reset",
                    desc: "Security-first password recovery email with clear action CTA and fallback URL.",
                  },
                  {
                    title: "Invoice & Receipt",
                    alias: "invoice-receipt",
                    desc: "Clean billing confirmation with invoice ID, line-item summary, and amount.",
                  },
                ].map((b) => (
                  <Link
                    key={b.alias}
                    href="/templates/new"
                    style={{
                      padding: 16,
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface-elevated)",
                      textDecoration: "none",
                      color: "var(--color-ink)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{b.title}</span>
                        <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                          {b.alias}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)", lineHeight: 1.5 }}>
                        {b.desc}
                      </p>
                    </div>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--color-accent)",
                      }}
                    >
                      <span>Open in Studio</span>
                      <ArrowRight size={12} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="ds-table-shell">
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Template Name</th>
                  <th>API Alias</th>
                  <th>Template ID</th>
                  <th style={{ textAlign: "right" }}>Created</th>
                  <th style={{ width: 100, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link
                        href={`/templates/${t.id}`}
                        style={{
                          fontWeight: 600,
                          color: "var(--color-ink)",
                          textDecoration: "none",
                        }}
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                        {t.alias ?? "—"}
                      </span>
                    </td>
                    <td>
                      <CopyableMono value={t.id} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <RelativeTime value={t.createdAt} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/templates/${t.id}`}
                        className="ds-btn ds-btn-secondary ds-btn-sm"
                        style={{ textDecoration: "none" }}
                      >
                        <span>Edit</span>
                        <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
