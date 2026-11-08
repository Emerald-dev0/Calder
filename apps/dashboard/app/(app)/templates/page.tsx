import { and, desc, ilike, inArray, or } from "drizzle-orm";
import { getDb, templates } from "@calder/db";
import { notFound } from "next/navigation";
import { getTenantContext } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import Link from "next/link";
import { FileCode2, Plus, ArrowRight, Search } from "lucide-react";
import {
  PAGE_SIZE,
  cursorWhere,
  decodeCursor,
  encodeCursor,
  stringParam,
} from "../../../lib/pagination";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
  CopyableMono,
} from "../../../components/design-system";

export const metadata = { title: "Calder — Templates" };

/**
 * Template library: scoped to the caller's projects, searchable by name/alias,
 * and cursor-paginated so a large collection stays navigable. Every query
 * carries the tenant predicate; a template in another organization is
 * indistinguishable from a missing one.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const query = await searchParams;
  const search = stringParam(query.q);
  let cursor: ReturnType<typeof decodeCursor>;
  try {
    cursor = decodeCursor(query.cursor);
  } catch {
    // A tampered cursor is a bad request, not a page with silently different
    // data. Matches the other paginated list pages.
    notFound();
  }

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
  const conditions = [inArray(templates.projectId, projectIds)];
  if (search) {
    const pattern = `%${search.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(templates.name, pattern), ilike(templates.alias, pattern))!);
  }
  const cw = cursorWhere(cursor, templates.createdAt, templates.id);
  if (cw) conditions.push(cw);

  const rows = await db
    .select()
    .from(templates)
    .where(and(...conditions))
    .orderBy(desc(templates.createdAt), desc(templates.id))
    .limit(PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  const qs = (extra: Record<string, string | undefined>) =>
    "?" +
    Object.entries({ q: search, ...extra })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");

  return (
    <div>
      <DsPageHeader
        icon={<FileCode2 size={18} />}
        title="Templates"
        badge={
          <StatusPill
            status={search && page.length === 0 ? "queued" : "active"}
            label={
              search
                ? `${page.length}${hasMore ? "+" : ""} matching`
                : `${page.length}${hasMore ? "+" : ""} ${page.length === 1 ? "template" : "templates"}`
            }
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

      <form
        method="get"
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 440 }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 11, top: 11, color: "var(--color-muted)" }}
          />
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search templates by name or alias…"
            className="ds-input"
            style={{ paddingLeft: 32 }}
            aria-label="Search templates"
          />
        </div>
        <button type="submit" className="ds-btn ds-btn-secondary">
          Search
        </button>
        {search && (
          <Link
            href="/templates"
            className="ds-btn ds-btn-ghost ds-btn-sm"
            style={{ textDecoration: "none" }}
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <>
          <EmptyState
            icon={<FileCode2 size={22} />}
            title={search ? "No templates match" : "No templates yet"}
            description={
              search
                ? "Try a different name or alias."
                : "Create reusable email templates for welcome emails, OTPs, password resets, and receipts. Variables, live preview, and test send included."
            }
            actionLabel={search ? "Clear search" : "Create template"}
            actionHref={search ? "/templates" : "/templates/new"}
          />

          {!search && (
          <div className="ds-card" style={{ marginTop: 16 }}>
            <div className="ds-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          )}
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
                {page.map((t) => (
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
          {nextCursor && (
            <div className="ds-card-footer">
              <Link
                href={`/templates${qs({ cursor: nextCursor })}`}
                className="ds-btn ds-btn-secondary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <span>More templates</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
