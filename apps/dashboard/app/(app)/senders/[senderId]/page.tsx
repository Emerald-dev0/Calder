import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb, emails, senderIdentities } from "@calder/db";
import { getTenantContext } from "../../../../lib/auth";
import {
  deliveryEventHealth,
  senderHealthFor,
  senderStreamStats,
  senderAllowedKeyIds,
  projectApiKeys,
} from "../actions";
import { SenderDetailActions } from "./sender-detail-actions";
import { UserCheck, ArrowLeft, ShieldAlert } from "lucide-react";
import { DsPageHeader, StatusPill, StatCard, DsBanner } from "../../../../components/design-system";
import { EmptyState } from "../../../../components/empty-state";
import {
  DeliveryEventNotice,
  DeliveryStatValue,
  deliverySubline,
} from "../../../../components/delivery-event-notice";

export async function generateMetadata({ params }: { params: Promise<{ senderId: string }> }) {
  const { senderId } = await params;
  return { title: `Calder — Sender ${senderId.slice(0, 18)}` };
}

export default async function SenderDetailPage({
  params,
}: {
  params: Promise<{ senderId: string }>;
}) {
  const { senderId } = await params;
  const ctx = await getTenantContext();
  const projectIds = [...new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)))];
  const db = getDb();
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(
      and(
        eq(senderIdentities.id, senderId),
        inArray(senderIdentities.projectId, projectIds.length > 0 ? projectIds : [""])
      )
    )
    .limit(1);
  if (!sender || !projectIds.includes(sender.projectId)) {
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

  const [totals, recent, health, stats, keyIds, apiKeys, deliveryHealth] = await Promise.all([
    db
      .select({ status: emails.status, value: count() })
      .from(emails)
      .where(and(eq(emails.senderIdentityId, sender.id), eq(emails.projectId, projectId)))
      .groupBy(emails.status),
    db
      .select({
        id: emails.id,
        to: emails.to,
        subject: emails.subject,
        status: emails.status,
        stream: emails.stream,
        createdAt: emails.createdAt,
      })
      .from(emails)
      .where(and(eq(emails.senderIdentityId, sender.id), eq(emails.projectId, projectId)))
      .orderBy(desc(emails.createdAt))
      .limit(10),
    senderHealthFor(sender.id),
    senderStreamStats(sender.id),
    senderAllowedKeyIds(sender.id),
    projectApiKeys(projectId),
    deliveryEventHealth(projectId),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const t of totals) {
    byStatus[t.status] = t.value;
    total += t.value;
  }

  const org = ctx.memberships.flatMap((m) =>
    m.projects.filter((p) => p.id === projectId).map(() => m.organization)
  )[0];

  const archived = Boolean(sender.archivedAt);
  const defaultLabels = [
    sender.isDefault ? "transactional default" : null,
    sender.isDefaultMarketing ? "broadcast default" : null,
  ].filter(Boolean);

  return (
    <div>
      <DsPageHeader
        icon={<UserCheck size={18} />}
        title={sender.displayName}
        badge={<StatusPill status={archived ? "disabled" : sender.status} />}
        description={
          <span>
            <span className="mono">{sender.email}</span> ·{" "}
            {sender.type === "gmail"
              ? "Gmail sender"
              : sender.type === "domain"
                ? "Domain sender"
                : "Managed sender"}
            {defaultLabels.length > 0 ? ` · ${defaultLabels.join(" · ")}` : ""} · {org?.name ?? ""}
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

      {archived && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="warning"
            title="This sender is archived"
            description="It is hidden from every picker and does not count towards your plan's sender-identity limit. Its delivery history is preserved. Restore it below to use it again."
          />
        </div>
      )}

      {health.warned && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="danger"
            title={`Bounce rate above 5% (${((health.bounceRate ?? 0) * 100).toFixed(1)}%)`}
            description={`${health.bounced7d} of ${health.sent7d} messages from this sender bounced in the last 7 days. Check that the address exists and that the domain's SPF/DKIM records are current.`}
          />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h2 className="ds-card-title" style={{ margin: 0 }}>
          Last 7 days
        </h2>
        <StatusPill
          status={health.bounceRate === null ? "pending" : health.warned ? "warning" : "healthy"}
          label={
            health.bounceRate === null
              ? "No traffic"
              : `${(health.bounceRate * 100).toFixed(1)}% bounce${
                  health.warned ? " · above 5% threshold" : ""
                }`
          }
        />
        {health.warned && <ShieldAlert size={14} color="var(--color-warning)" />}
      </div>

      <DeliveryEventNotice health={deliveryHealth} projectId={projectId} />

      <div className="ds-grid-4" style={{ marginBottom: 10 }}>
        <StatCard
          label="Transactional sent"
          value={stats.transactional.sent.toLocaleString()}
          sub={
            <>
              <DeliveryStatValue count={stats.transactional.delivered} health={deliveryHealth} />{" "}
              delivered ·{" "}
              <DeliveryStatValue count={stats.transactional.bounced} health={deliveryHealth} />{" "}
              bounced
            </>
          }
        />
        <StatCard
          label="Broadcast sent"
          value={stats.marketing.sent.toLocaleString()}
          sub={
            <>
              <DeliveryStatValue count={stats.marketing.delivered} health={deliveryHealth} />{" "}
              delivered ·{" "}
              <DeliveryStatValue count={stats.marketing.bounced} health={deliveryHealth} /> bounced
            </>
          }
        />
        <StatCard
          label="Complaints"
          value={
            <DeliveryStatValue
              count={stats.transactional.complained + stats.marketing.complained}
              health={deliveryHealth}
            />
          }
          status={
            deliveryHealth.zerosTrusted
              ? stats.transactional.complained + stats.marketing.complained > 0
                ? "warning"
                : "healthy"
              : "unknown"
          }
          sub={deliverySubline(deliveryHealth, "Marked as spam, 7 days")}
        />
        <StatCard
          label="Lifetime volume"
          value={total.toLocaleString()}
          sub={
            <>
              <DeliveryStatValue count={byStatus.delivered ?? 0} health={deliveryHealth} />{" "}
              delivered all time
            </>
          }
        />
      </div>

      <SenderDetailActions
        sender={{
          id: sender.id,
          projectId,
          displayName: sender.displayName,
          email: sender.email,
          type: sender.type,
          status: sender.status,
          isDefault: sender.isDefault,
          isDefaultMarketing: sender.isDefaultMarketing,
          replyTo: sender.replyTo,
          archived,
          emailCount: total,
        }}
        apiKeys={apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          env: k.env,
          keyPrefix: k.keyPrefix,
        }))}
        allowedKeyIds={keyIds}
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
                    {r.stream === "marketing" && (
                      <span style={{ marginLeft: 8 }}>
                        <StatusPill status="test" label="Broadcast" />
                      </span>
                    )}
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
