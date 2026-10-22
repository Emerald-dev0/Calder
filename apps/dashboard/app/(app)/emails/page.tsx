import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, senderIdentities } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { ProjectPicker } from "../project-picker";
import { Mail, Send, Download } from "lucide-react";
import {
  CopyableMono,
  DsPageHeader,
  RelativeTime,
  StatusPill,
} from "../../../components/design-system";
import { decodeCursor, encodeCursor, PAGE_SIZE } from "../../../lib/pagination";
import { notFound } from "next/navigation";
import {
  RANGES,
  RANGE_LABELS,
  STREAM_LABELS,
  STATUSES,
  filtersToQuery,
  hasActiveFilters,
  looksLikeMessageId,
  parseFilters,
  type StreamFilter,
} from "../../../lib/emails/filters";
import {
  countEmailsByStream,
  findEmailDetail,
  listEmails,
  listSenderDomains,
} from "../../../lib/emails/queries";
import { EmailFilterBar } from "./filter-bar";
import { LiveToggle } from "./live-toggle";
import { MessagePanel } from "./message-panel";

export const metadata = { title: "Calder — Emails" };

const STREAM_TABS: StreamFilter[] = ["all", "transactional", "marketing"];

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project as string | undefined);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<Mail size={18} />}
          title="Emails"
          description="No project found. Create a project to start sending."
        />
        <EmptyState
          title="No project found"
          description="Provision an organization and project to dispatch emails."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const projectId = scope.project.id;
  const filters = parseFilters(query);

  let cursor: ReturnType<typeof decodeCursor>;
  try {
    cursor = decodeCursor(query.cursor as string | undefined);
  } catch {
    notFound();
  }

  const db = getDb();

  // Stream tabs need counts for the whole project, unaffected by the other
  // filters — otherwise the tabs would show what is already filtered out.
  const { byStream, total: totalAll } = await countEmailsByStream(db, projectId);

  const senders = await db
    .select({
      id: senderIdentities.id,
      displayName: senderIdentities.displayName,
      email: senderIdentities.email,
    })
    .from(senderIdentities)
    .where(eq(senderIdentities.projectId, projectId));

  const domains = await listSenderDomains(db, projectId);

  const rows = await listEmails(db, {
    projectId,
    filters,
    cursor,
    limit: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!) : null;

  // The open message is a URL parameter, so a shared link opens the same panel.
  const messageParam = typeof query.message === "string" ? query.message : undefined;
  const selected =
    messageParam && looksLikeMessageId(messageParam)
      ? await findEmailDetail(db, projectId, messageParam)
      : null;

  const filterQuery = filtersToQuery(filters, { project: projectId });

  return (
    <div>
      <DsPageHeader
        icon={<Mail size={18} />}
        title="Emails"
        badge={
          <StatusPill
            status="active"
            label={`${totalAll.toLocaleString("en-US")} ${totalAll === 1 ? "message" : "messages"}`}
          />
        }
        description="Every outbound send under this project. Click a row to inspect its real delivery timeline, rendered content and headers."
        actions={
          <>
            <LiveToggle projectId={projectId} />
            <a
              href={`/emails/export?${filterQuery}`}
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <Download size={14} />
              <span>Export CSV</span>
            </a>
            <Link
              href={`/emails/new?project=${projectId}`}
              className="ds-btn ds-btn-primary"
              style={{ textDecoration: "none" }}
            >
              <Send size={14} />
              <span>Send email</span>
            </Link>
          </>
        }
      />

      <ProjectPicker
        projects={ctx.memberships
          .flatMap((m) => m.projects)
          .map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={projectId}
        basePath="/emails"
      />

      {/* Stream tabs. `marketing` stays the value; "Broadcast" is the label. */}
      <div
        className="ds-tabs"
        role="tablist"
        aria-label="Filter by stream"
        style={{ marginBottom: 14 }}
      >
        {STREAM_TABS.map((stream) => {
          const active = filters.stream === stream;
          const n = stream === "all" ? totalAll : (byStream.get(stream) ?? 0);
          const params = filtersToQuery({ ...filters, stream }, { project: projectId });
          return (
            <Link
              key={stream}
              href={`/emails?${params}`}
              role="tab"
              aria-selected={active}
              className={`ds-tab ${active ? "is-active" : ""}`}
              style={{ textDecoration: "none" }}
              data-testid={`stream-${stream}`}
            >
              <span>{STREAM_LABELS[stream]}</span>
              <span className="tabular-nums" style={{ opacity: 0.7, fontSize: 11.5 }}>
                {n}
              </span>
            </Link>
          );
        })}
      </div>

      <EmailFilterBar
        projectId={projectId}
        filters={filters}
        senders={senders}
        domains={domains}
        statuses={[...STATUSES]}
        ranges={RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
      />

      {page.length === 0 ? (
        <EmptyState
          icon={<Mail size={22} />}
          title={
            hasActiveFilters(filters) ? "No messages match these filters" : "No emails sent yet"
          }
          description={
            hasActiveFilters(filters)
              ? "Try a wider date range, another stream, or clear the search."
              : "Send a message from the composer, or POST /v1/emails with a scoped API key. Delivery status appears here in real time."
          }
          actionHref={
            hasActiveFilters(filters)
              ? `/emails?project=${projectId}`
              : `/emails/new?project=${projectId}`
          }
          actionLabel={hasActiveFilters(filters) ? "Clear filters" : "Send an email"}
        />
      ) : (
        <>
          <div className="ds-table-shell">
            <div className="ds-table-scroll">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th style={{ width: 128 }}>Status</th>
                    <th>Recipient &amp; subject</th>
                    <th style={{ width: 110 }}>Stream</th>
                    <th style={{ width: 196 }}>Message ID</th>
                    <th style={{ width: 120, textAlign: "right" }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((r) => {
                    const href = `/emails?${filtersToQuery(filters, {
                      project: projectId,
                      message: r.id,
                    })}`;
                    return (
                      <tr key={r.id} data-testid="email-row">
                        <td>
                          <StatusPill status={r.status} />
                        </td>
                        <td>
                          <Link
                            href={href}
                            style={{ textDecoration: "none", color: "inherit", display: "block" }}
                          >
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 13,
                                color: "var(--color-ink)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {r.subject || "(no subject)"}
                            </div>
                            <div
                              className="mono"
                              style={{
                                fontSize: 11.5,
                                color: "var(--color-muted)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              → {r.to}
                            </div>
                          </Link>
                        </td>
                        <td>
                          <StatusPill
                            status={r.stream === "marketing" ? "live" : "sent"}
                            label={
                              r.stream === "marketing"
                                ? STREAM_LABELS.marketing
                                : STREAM_LABELS.transactional
                            }
                          />
                        </td>
                        <td>
                          <CopyableMono value={r.id} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <RelativeTime value={r.createdAt.toISOString()} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 14,
            }}
          >
            <span className="tabular-nums" style={{ fontSize: 12, color: "var(--color-muted)" }}>
              Showing {page.length} on this page
            </span>
            {nextCursor && (
              <Link
                className="ds-btn ds-btn-secondary"
                style={{ textDecoration: "none" }}
                href={`/emails?${filtersToQuery(filters, {
                  project: projectId,
                  cursor: nextCursor,
                })}`}
              >
                {filters.sort === "oldest" ? "Next page" : "Older messages"}
              </Link>
            )}
          </div>
        </>
      )}

      {selected && (
        <MessagePanel
          projectId={projectId}
          message={selected.message}
          events={selected.events}
          alreadySuppressed={selected.alreadySuppressed}
          closeHref={`/emails?${filtersToQuery(filters, { project: projectId })}`}
          templateName={selected.templateName}
          apiKeyUsed={selected.apiKeyUsed}
        />
      )}
    </div>
  );
}
