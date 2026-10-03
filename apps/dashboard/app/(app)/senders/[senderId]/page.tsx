import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { getDb, emails, senderIdentities } from "@calder/db";
import { getTenantContext } from "../../../../lib/auth";
import { SenderActions } from "./sender-actions";
import { UserCheck, ArrowLeft } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  StatCard,
} from "../../../../components/design-system";
import { EmptyState } from "../../../../components/empty-state";

export async function generateMetadata({ params }: { params: { senderId: string } }) {
  return { title: `Calder — Sender ${params.senderId.slice(0, 18)}` };
}

export default async function SenderDetailPage({ params }: { params: { senderId: string } }) {
  const ctx = await getTenantContext();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const db = getDb();
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.id, params.senderId))
    .limit(1);
  if (!sender || !projectIds.has(sender.projectId)) {
    return (
      <div>
        <DsPageHeader icon={<UserCheck size={18} />} title="Sender Not Found" />
        <EmptyState
          title="Sender not found"
          description="This sender identity does not exist in your accessible projects."
          actionLabel="Back to Senders"
          actionHref="/senders"
        />
      </div>
    );
  }
  const projectId = sender.projectId;

  const totals = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(eq(emails.senderIdentityId, sender.id))
    .groupBy(emails.status);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const t of totals) {
    byStatus[t.status] = t.value;
    total += t.value;
  }
  const recent = await db
    .select({ id: emails.id, to: emails.to, subject: emails.subject, status: emails.status })
    .from(emails)
    .where(eq(emails.senderIdentityId, sender.id))
    .orderBy(desc(emails.createdAt))
    .limit(10);

  const org = ctx.memberships.flatMap((m) =>
    m.projects.filter((p) => p.id === projectId).map(() => m.organization),
  )[0];

  return (
    <div>
      <DsPageHeader
        icon={<UserCheck size={18} />}
        title={sender.displayName}
        badge={<StatusPill status={sender.status} />}
        description={
          <span>
            <span className="mono">{sender.email}</span> ·{" "}
            {sender.type === "gmail"
              ? "Gmail sender"
              : sender.type === "domain"
                ? "Domain sender"
                : "Managed sender"}
            {sender.isDefault ? " · Default Identity" : ""} · {org?.name ?? ""}
          </span>
        }
        actions={
          <Link
            href={`/senders?project=${projectId}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft size={14} />
            <span>Back to Senders</span>
          </Link>
        }
      />

      <div className="ds-grid-3" style={{ marginBottom: 20 }}>
        <StatCard label="Emails Sent" value={total.toLocaleString()} sub="Total volume" />
        <StatCard
          label="Delivered"
          value={(byStatus.delivered ?? 0).toLocaleString()}
          status="delivered"
          sub="Confirmed 250 OK"
        />
        <StatCard
          label="Bounced + Failed"
          value={((byStatus.bounced ?? 0) + (byStatus.failed ?? 0)).toLocaleString()}
          status={(byStatus.bounced ?? 0) + (byStatus.failed ?? 0) > 0 ? "bounced" : "healthy"}
          sub="Delivery rejections"
        />
      </div>

      <SenderActions
        sender={{
          id: sender.id,
          projectId,
          displayName: sender.displayName,
          email: sender.email,
          status: sender.status,
          isDefault: sender.isDefault,
          emailCount: total,
        }}
      />

      <div className="ds-card" style={{ marginTop: 20 }}>
        <div className="ds-card-header">
          <h2 className="ds-card-title">Recent Deliveries from {sender.email}</h2>
        </div>
        <div className="ds-card-body">
          {recent.length === 0 ? (
            <p style={{ color: "var(--color-muted)", fontSize: 13.5, margin: 0 }}>
              Nothing sent from this sender identity yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {recent.map((r, i) => (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 4px",
                    borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                    fontSize: 13.5,
                  }}
                >
                  <span>
                    <b>{r.subject}</b>{" "}
                    <span className="mono" style={{ color: "var(--color-muted)", fontSize: 12 }}>
                      → {r.to}
                    </span>
                  </span>
                  <StatusPill status={r.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
