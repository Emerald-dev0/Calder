import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import {
  getDb,
  inboxMembers,
  inboxRoutes,
  inboxes,
  organizationMembers,
  receivingDomains,
  senderIdentities,
  users,
} from "@calder/db";
import { Inbox as InboxIcon } from "lucide-react";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { visibleInboxesForProject } from "../../../../lib/inbox/guard";
import { ProjectPicker } from "../../project-picker";
import { DsBanner, DsPageHeader, StatusPill } from "../../../../components/design-system";
import { EmptyState } from "../../../../components/empty-state";
import { InboxAdmin, InboxPeople, InboxRouteRow, NewInboxForm } from "./forms";

/**
 * Inbox settings.
 *
 * One page for the four things that make an inbox work: its name and reply
 * identity, the addresses that deliver into it, who can open it, and their
 * roles. Everything here is gated on `manageSettings` / `manageMembers`, which
 * are mailbox-level capabilities — an organisation admin is a manager by
 * definition, a member with no inbox row sees nothing at all.
 */
export default async function InboxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; inbox?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);

  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<InboxIcon size={18} />}
          title="Inbox settings"
          description="No project found."
        />
        <EmptyState
          title="No project found"
          description="Choose a project first."
          actionLabel="Settings"
          actionHref="/settings"
        />
      </div>
    );
  }

  const projectId = scope.project.id;
  const db = getDb();
  const { rows: visible, organizationRole } = await visibleInboxesForProject(projectId);
  const canManage = organizationRole === "owner" || organizationRole === "admin";

  const [domains, senders] = await Promise.all([
    db
      .select()
      .from(receivingDomains)
      .where(eq(receivingDomains.projectId, projectId))
      .orderBy(receivingDomains.domain),
    db
      .select()
      .from(senderIdentities)
      .where(
        and(eq(senderIdentities.projectId, projectId), eq(senderIdentities.status, "verified"))
      )
      .orderBy(senderIdentities.email),
  ]);

  const inboxIds = visible.map((i) => i.id);
  const [routes, members, roster] = await Promise.all([
    inboxIds.length
      ? db
          .select({
            id: inboxRoutes.id,
            inboxId: inboxRoutes.inboxId,
            localPart: inboxRoutes.localPart,
            domainId: inboxRoutes.receivingDomainId,
            domain: receivingDomains.domain,
          })
          .from(inboxRoutes)
          .innerJoin(receivingDomains, eq(receivingDomains.id, inboxRoutes.receivingDomainId))
          .where(inArray(inboxRoutes.inboxId, inboxIds))
      : Promise.resolve([]),
    inboxIds.length
      ? db
          .select({
            id: inboxMembers.id,
            inboxId: inboxMembers.inboxId,
            userId: inboxMembers.userId,
            role: inboxMembers.role,
            notify: inboxMembers.notify,
            name: users.name,
            email: users.email,
          })
          .from(inboxMembers)
          .innerJoin(users, eq(users.id, inboxMembers.userId))
          .where(inArray(inboxMembers.inboxId, inboxIds))
      : Promise.resolve([]),
    scope.organization.id
      ? db
          .select({ userId: organizationMembers.userId, name: users.name, email: users.email })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(eq(organizationMembers.organizationId, scope.organization.id))
      : Promise.resolve([]),
  ]);

  const inboxRows = inboxIds.length
    ? await db.select().from(inboxes).where(inArray(inboxes.id, inboxIds))
    : [];

  return (
    <div>
      <DsPageHeader
        icon={<InboxIcon size={18} />}
        title="Inbox settings"
        description="Inboxes, the addresses that deliver to them, and who can work in them."
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ProjectPicker
              projects={ctx.memberships.flatMap((m) => m.projects)}
              currentId={projectId}
              basePath="/inbox/settings"
            />
            <Link className="ds-btn ds-btn-ghost" href={`/inbox?project=${projectId}`}>
              Back to inbox
            </Link>
          </div>
        }
      />

      {!canManage && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="neutral"
            title="Contact an owner to create inboxes"
            description="Only organisation owners and admins can create an inbox or change its sender and routing. Inbox managers can manage the people inside an inbox they already manage."
          />
        </div>
      )}

      {canManage && (
        <NewInboxForm
          projectId={projectId}
          domains={domains.map((d) => ({ id: d.id, domain: d.domain, status: d.status }))}
          senders={senders.map((s) => ({ id: s.id, email: s.email }))}
        />
      )}

      {inboxRows.length === 0 ? (
        <EmptyState
          title="No inboxes yet"
          description="Create an inbox, then point one of your verified receiving domains at it."
        />
      ) : (
        inboxRows.map((inbox) => {
          const inboxRoutesRows = routes.filter((r) => r.inboxId === inbox.id);
          const inboxMemberRows = members.filter((m) => m.inboxId === inbox.id);
          const capabilities = visible.find((v) => v.id === inbox.id)?.capabilities ?? [];
          return (
            <section key={inbox.id} className="ds-card" style={{ padding: 16, marginBottom: 18 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <h2 className="ds-card-title" style={{ margin: 0 }}>
                  {inbox.name}
                </h2>
                <StatusPill status={inbox.status} />
                <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>
                  {inbox.slug}
                </span>
                <a
                  className="ds-btn ds-btn-ghost"
                  href={`/inbox?inbox=${inbox.id}&project=${projectId}`}
                  style={{ marginLeft: "auto" }}
                >
                  Open
                </a>
              </div>

              <p className="ds-card-subtitle" style={{ marginTop: 6 }}>
                {inboxRoutesRows.length > 0
                  ? `Receives mail for ${inboxRoutesRows.map((r) => `${r.localPart}@${r.domain}`).join(", ")}`
                  : "No address routes to this inbox yet, so nothing can arrive."}
                {inbox.defaultSenderId
                  ? ` · replies send from ${senders.find((s) => s.id === inbox.defaultSenderId)?.email ?? "a removed identity"}`
                  : " · replies disabled (no sender identity)"}
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 16,
                  marginTop: 14,
                }}
              >
                <div>
                  <h3 style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.65 }}>Inbox</h3>
                  <InboxAdmin
                    inboxId={inbox.id}
                    name={inbox.name}
                    defaultSenderId={inbox.defaultSenderId}
                    senders={senders.map((s) => ({ id: s.id, email: s.email }))}
                    canManage={capabilities.includes("manageSettings")}
                  />
                </div>
                <div>
                  <h3 style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.65 }}>
                    Routing
                  </h3>
                  {inboxRoutesRows.map((route) => (
                    <InboxRouteRow
                      key={route.id}
                      inboxId={inbox.id}
                      receivingDomainId={route.domainId}
                      localPart={route.localPart}
                      address={`${route.localPart}@${route.domain}`}
                      canManage={capabilities.includes("manageSettings")}
                    />
                  ))}
                  <InboxRouteRow
                    inboxId={inbox.id}
                    receivingDomainId={domains[0]?.id ?? ""}
                    localPart=""
                    address=""
                    domains={domains.map((d) => ({ id: d.id, domain: d.domain }))}
                    canManage={capabilities.includes("manageSettings")}
                  />
                </div>
                <div>
                  <h3 style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.65 }}>
                    People
                  </h3>
                  <InboxPeople
                    inboxId={inbox.id}
                    members={inboxMemberRows.map((m) => ({
                      userId: m.userId,
                      name: m.name,
                      email: m.email,
                      role: m.role,
                      notify: m.notify,
                    }))}
                    roster={roster}
                    viewerUserId={ctx.user.userId}
                    canManage={capabilities.includes("manageMembers")}
                  />
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
