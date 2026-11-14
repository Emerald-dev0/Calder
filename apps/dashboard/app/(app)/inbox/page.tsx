import Link from "next/link";
import { Inbox as InboxIcon, Search } from "lucide-react";
import { getDb, inboxes, listConversations } from "@calder/db";
import { eq } from "drizzle-orm";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { visibleInboxesForProject } from "../../../lib/inbox/guard";
import { ProjectPicker } from "../project-picker";
import { DsBanner, DsPageHeader, StatusPill } from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";

/**
 * Shared inbox.
 *
 * The rail only lists inboxes this person may open — organisation owners and
 * admins see all of them, everyone else sees the ones they were added to. An
 * `?inbox=` id outside that set is ignored rather than 403'd, so a stale
 * bookmark lands somewhere usable instead of on an error page.
 *
 * Conversations are listed from the same query the conversation page reads, and
 * nothing here claims mail is being received: if inbound is not configured the
 * banner says so.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    inbox?: string;
    status?: string;
    q?: string;
    mine?: string;
  }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);

  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<InboxIcon size={18} />}
          title="Inbox"
          description="No project found."
        />
        <EmptyState
          title="No project found"
          description="Inboxes belong to a project. Create one in your workspace settings."
          actionLabel="Configure workspace"
          actionHref="/settings"
        />
      </div>
    );
  }

  const projectId = scope.project.id;
  const { rows: visible, userId } = await visibleInboxesForProject(projectId);

  if (visible.length === 0) {
    return (
      <div>
        <DsPageHeader
          icon={<InboxIcon size={18} />}
          title="Inbox"
          description="Shared mailboxes for this project."
          actions={
            <ProjectPicker
              projects={ctx.memberships.flatMap((m) => m.projects)}
              currentId={projectId}
              basePath="/inbox"
            />
          }
        />
        <EmptyState
          title="No inbox you can open"
          description="Either this project has no inbox yet, or you have not been added to one. Organisation owners and admins can create inboxes and add people."
          actionLabel="Inbox settings"
          actionHref={`/inbox/settings?project=${projectId}`}
        />
      </div>
    );
  }

  const selected = visible.find((i) => i.id === query.inbox) ?? visible[0]!;
  const status =
    query.status === "all" || query.status === "pending" || query.status === "closed"
      ? query.status
      : "open";

  const { rows } = await listConversations(getDb(), {
    inboxId: selected.id,
    status,
    q: query.q?.trim() || undefined,
    assigneeUserId: query.mine === "1" ? userId : undefined,
    limit: 50,
  });

  const db = getDb();
  const [inboxRow] = await db.select().from(inboxes).where(eq(inboxes.id, selected.id)).limit(1);

  return (
    <div>
      <DsPageHeader
        icon={<InboxIcon size={18} />}
        title={inboxRow?.name ?? "Inbox"}
        badge={
          <StatusPill
            status={selected.capabilities.includes("manageSettings") ? "active" : "info"}
            label={
              selected.role.startsWith("org:")
                ? `${selected.role.slice(4)} (workspace)`
                : selected.role
            }
          />
        }
        description={
          <span className="mono" style={{ fontSize: 12 }}>
            {(inboxRow?.replyToAddress ?? "") || "received mail"}
          </span>
        }
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ProjectPicker
              projects={ctx.memberships.flatMap((m) => m.projects)}
              currentId={projectId}
              basePath="/inbox"
            />
            <Link className="ds-btn ds-btn-ghost" href={`/inbox/settings?project=${projectId}`}>
              Inbox settings
            </Link>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 20 }}>
        <nav aria-label="Inboxes">
          <div style={{ display: "grid", gap: 6 }}>
            {visible.map((inbox) => (
              <Link
                key={inbox.id}
                href={`/inbox?inbox=${inbox.id}&project=${projectId}`}
                className={`ds-btn ${inbox.id === selected.id ? "ds-btn-primary" : "ds-btn-ghost"}`}
                style={{ justifyContent: "flex-start" }}
              >
                {inbox.name}
              </Link>
            ))}
          </div>
        </nav>

        <div>
          <form
            method="get"
            action="/inbox"
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
          >
            <input type="hidden" name="inbox" value={selected.id} />
            <input type="hidden" name="project" value={projectId} />
            <input
              name="q"
              defaultValue={query.q ?? ""}
              placeholder="Search subject, people, message text"
              className="ds-input"
              style={{ flex: "1 1 260px" }}
              aria-label="Search conversations"
            />
            <select name="status" defaultValue={status} className="ds-select" aria-label="Status">
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" name="mine" value="1" defaultChecked={query.mine === "1"} />
              Assigned to me
            </label>
            <button className="ds-btn ds-btn-secondary" type="submit">
              <Search size={13} /> Filter
            </button>
          </form>

          {rows.length === 0 ? (
            <EmptyState
              title="No conversations"
              description={
                query.q
                  ? "Nothing matches that search in this inbox."
                  : "No conversations match these filters yet."
              }
            />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/inbox/${conversation.id}`}
                  className="ds-card"
                  style={{
                    padding: 14,
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}
                  >
                    <StatusPill status={conversation.status} />
                    <strong style={{ fontSize: 13 }}>
                      {conversation.subject ?? "(no subject)"}
                    </strong>
                    {conversation.assigneeName && (
                      <span style={{ fontSize: 11, opacity: 0.75 }}>
                        → {conversation.assigneeName}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>
                      {conversation.lastMessageAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    {conversation.participants.slice(0, 3).join(", ")}
                    {conversation.participants.length > 3
                      ? ` +${conversation.participants.length - 3}`
                      : ""}
                    {" · "}
                    {conversation.messageCount} message{conversation.messageCount === 1 ? "" : "s"}
                  </div>
                  {conversation.labels.length > 0 && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      {conversation.labels.map((label) => (
                        <span key={label} className="ds-pill">
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <DsBanner
              tone="neutral"
              title="Receiving is separate from sending"
              description="Mail arrives here when a receiving domain is verified, its SES receipt rule is recorded, and an address routes to this inbox. Replies send from the inbox's own sender identity and count as outbound email."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
