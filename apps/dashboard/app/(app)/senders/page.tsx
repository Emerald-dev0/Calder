import Link from "next/link";
import { UserCheck, Globe, ArrowRight, Radio, MailCheck } from "lucide-react";
import { checkOrganizationResource, getDb, gmailAllowanceForTransport } from "@calder/db";
import { planDisplayName } from "@calder/config";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { pricingUrl } from "../../../lib/pricing";
import {
  deliveryEventHealth,
  listSenders,
  senderHealth,
  senderCreationOptions,
  streamStats,
  unattributedSends,
} from "./actions";
import { AddSender } from "./add-sender";
import { SenderTable } from "./sender-table";
import { DsPageHeader, StatusPill, DsBanner, StatCard } from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";
import {
  DeliveryEventNotice,
  DeliveryStatValue,
  deliverySubline,
} from "../../../components/delivery-event-notice";

export const metadata = { title: "Calder — Senders" };

const STREAMS = ["transactional", "marketing"] as const;
type Stream = (typeof STREAMS)[number];
const STREAM_LABELS: Record<Stream, string> = {
  transactional: "Transactional",
  marketing: "Broadcast",
};

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; tab?: string; stream?: string; archived?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<UserCheck size={18} />}
          title="Sender Identities"
          description="No project found. Create one to add senders."
        />
        <EmptyState
          title="No project found"
          description="Create a project in your workspace settings to register sender identities."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const projectId = scope.project.id;
  const tab = query.tab === "broadcasts" ? "broadcasts" : "senders";
  const stream: Stream = query.stream === "marketing" ? "marketing" : "transactional";
  const showArchived = query.archived === "1";

  const [allSenders, health, options] = await Promise.all([
    listSenders(projectId, { includeArchived: true }),
    senderHealth(projectId),
    senderCreationOptions(projectId),
  ]);
  const gmailAllowances = await Promise.all(
    options.gmailTransports.map(async (transport) => ({
      ...transport,
      allowance: await gmailAllowanceForTransport(getDb(), projectId, transport.id),
    }))
  );
  const activeSenders = allSenders.filter((s) => !s.archivedAt);
  const archivedSenders = allSenders.filter((s) => s.archivedAt);

  // Two facts the cards need before they may print a zero: is SES reporting
  // back at all, and how much of the volume has no sender identity. Both are
  // loaded here so the page renders one story, not four independently-worded
  // ones.
  const [stats, deliveryHealth, unattributed] = await Promise.all([
    streamStats(projectId),
    deliveryEventHealth(projectId),
    unattributedSends(projectId),
  ]);
  const seg = stats[stream];

  // Plan usage for the sender-identity ceiling. Counts are organization-wide
  // and exclude archived senders, exactly as the enforcement does.
  const limitDecision = await checkOrganizationResource(getDb(), scope.organization.id, "senders");
  const atLimit = limitDecision.limit !== null && limitDecision.used >= limitDecision.limit;

  const verifiedCount = activeSenders.filter(
    (s) => s.status === "verified" || s.status === "connected"
  ).length;
  const warnCount = Object.values(health).filter((h) => h.warned).length;
  const base = `/senders?project=${projectId}`;

  return (
    <div>
      <DsPageHeader
        icon={<UserCheck size={18} />}
        title="Sender Identities"
        badge={
          <StatusPill
            status={verifiedCount > 0 ? "verified" : "pending"}
            label={
              activeSenders.length === 0
                ? "0 senders"
                : `${verifiedCount} of ${activeSenders.length} ready`
            }
          />
        }
        description={`${scope.organization.name} → ${scope.project.name} · Manage verified From addresses, defaults, and deliverability.`}
        actions={
          <Link
            href={`/domains?project=${projectId}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <Globe size={14} />
            <span>Manage Domains</span>
          </Link>
        }
      />

      {gmailAllowances.length > 0 && (
        <section
          className="ds-card"
          style={{ marginTop: 16, marginBottom: 20 }}
          aria-label="Gmail sending allowance"
        >
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Gmail sending allowance</h2>
              <p className="ds-card-subtitle">
                Per connected account across projects. Attempts count, including retries and failed
                provider calls. Organization, abuse and Google limits may also apply.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            {gmailAllowances.map(
              ({ id, label, allowance }) =>
                allowance && (
                  <div
                    key={id}
                    style={{ padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}
                  >
                    <strong>{label}</strong>
                    <p style={{ margin: "6px 0", color: "var(--color-ink-secondary)" }}>
                      <strong>{allowance.remaining} remaining</strong> · {allowance.used} of{" "}
                      {allowance.limit} used
                    </p>
                    <p className="ds-card-subtitle">
                      {!allowance.firstSendAt
                        ? "First 24 hours: 20 attempts, starting with the first send attempt. After that: 100 per UTC day."
                        : allowance.warmupEndsAt && new Date() < allowance.warmupEndsAt
                          ? `First 24-hour allowance ends ${allowance.warmupEndsAt.toUTCString()}. After that: up to 100 per UTC day.`
                          : `Daily allowance resets ${allowance.dailyResetAt.toUTCString()}.`}
                    </p>
                  </div>
                )
            )}
          </div>
        </section>
      )}

      {/* Tabs: Senders | Broadcasts. Broadcasts is deliberately inert: sending
          campaigns is a later phase, so it states the fact instead of querying. */}
      <div
        className="ds-tabs"
        role="tablist"
        aria-label="Sender sections"
        style={{ marginBottom: 16 }}
      >
        <Link
          href={base}
          role="tab"
          aria-selected={tab === "senders"}
          className={`ds-tab ${tab === "senders" ? "is-active" : ""}`}
          style={{ textDecoration: "none" }}
          data-testid="tab-senders"
        >
          <UserCheck size={13} />
          <span>Senders</span>
        </Link>
        <Link
          href={`${base}&tab=broadcasts`}
          role="tab"
          aria-selected={tab === "broadcasts"}
          className={`ds-tab ${tab === "broadcasts" ? "is-active" : ""}`}
          style={{ textDecoration: "none" }}
          data-testid="tab-broadcasts"
        >
          <Radio size={13} />
          <span>Broadcasts</span>
        </Link>
      </div>

      {tab === "broadcasts" ? (
        <EmptyState
          icon={<Radio size={22} />}
          title="No broadcasts yet"
          description="Broadcasts are sent to an audience. Audience management and campaign sending arrive in a later release — nothing has been sent, and nothing is queued."
          actionLabel="Manage senders"
          actionHref={base}
        />
      ) : (
        <>
          {warnCount > 0 && (
            <div style={{ marginBottom: 16 }}>
              <DsBanner
                tone="warning"
                title={`${warnCount} sender${warnCount === 1 ? "" : "s"} above 5% bounce rate`}
                description="Bounce rate is measured over the last 7 days of real delivery events. A high rate usually means the address is stale or the domain's DKIM/SPF records are wrong."
                action={
                  <Link
                    href={`${base}&archived=0#senders`}
                    className="ds-btn ds-btn-secondary ds-btn-sm"
                    style={{ textDecoration: "none" }}
                  >
                    <span>Review senders</span>
                  </Link>
                }
              />
            </div>
          )}

          {/* Stream-segmented stats. The segment lives in the URL, so the choice
              survives a refresh and can be shared. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div className="ds-tabs" role="tablist" aria-label="Delivery stream">
              {STREAMS.map((s) => (
                <Link
                  key={s}
                  href={`${base}&stream=${s}`}
                  role="tab"
                  aria-selected={stream === s}
                  className={`ds-tab ${stream === s ? "is-active" : ""}`}
                  style={{ textDecoration: "none" }}
                >
                  {STREAM_LABELS[s]}
                </Link>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
              Last 7 days · {STREAM_LABELS[stream].toLowerCase()} stream only
            </span>
          </div>

          <DeliveryEventNotice health={deliveryHealth} projectId={projectId} />

          {/* Arithmetic that adds up. The sender table below is per-identity,
              so unattributed sends are invisible in it; without this line the
              stream total and the table simply disagree. */}
          {unattributed > 0 && (
            <div
              data-testid="unattributed-sends"
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--color-border, rgba(0,0,0,.12))",
                fontSize: 13,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span>
                <strong>{unattributed.toLocaleString()}</strong> sent without a registered sender
                {unattributed === 1 ? "" : "s"} in the last 7 days.
              </span>
              <Link
                href={`/emails?project=${projectId}&range=7d&sender=unattributed`}
                style={{ textDecoration: "none" }}
                data-testid="unattributed-emails"
              >
                View those messages
              </Link>
              <span aria-hidden="true" style={{ color: "var(--color-muted)" }}>
                ·
              </span>
              <Link
                href={`${base}#add-sender`}
                style={{ textDecoration: "none" }}
                data-testid="unattributed-add-sender"
              >
                Add Sender Identity
              </Link>
            </div>
          )}

          <div className="ds-grid-4" style={{ marginBottom: 20 }}>
            <StatCard label="Sent" value={seg.sent.toLocaleString()} sub="Accepted for delivery" />
            <StatCard
              label="Delivered"
              value={<DeliveryStatValue count={seg.delivered} health={deliveryHealth} />}
              status={deliveryHealth.zerosTrusted ? "delivered" : "unknown"}
              sub={deliverySubline(deliveryHealth, "Confirmed by provider")}
            />
            <StatCard
              label="Bounced"
              value={<DeliveryStatValue count={seg.bounced} health={deliveryHealth} />}
              status={
                deliveryHealth.zerosTrusted ? (seg.bounced > 0 ? "bounced" : "healthy") : "unknown"
              }
              sub={deliverySubline(deliveryHealth, "Hard and soft rejections")}
            />
            <StatCard
              label="Complaints"
              value={<DeliveryStatValue count={seg.complained} health={deliveryHealth} />}
              status={
                deliveryHealth.zerosTrusted
                  ? seg.complained > 0
                    ? "warning"
                    : "healthy"
                  : "unknown"
              }
              sub={deliverySubline(deliveryHealth, "Marked as spam")}
            />
          </div>

          <div id="senders">
            <SenderTable
              projectId={projectId}
              senders={showArchived ? allSenders : activeSenders}
              health={health}
              archivedCount={archivedSenders.length}
              showArchived={showArchived}
              basePath={base}
            />
          </div>

          {atLimit && (
            <div style={{ marginTop: 16 }}>
              <DsBanner
                tone={limitDecision.allowed ? "info" : "warning"}
                title={`Sender identity limit reached (${limitDecision.used} of ${limitDecision.limit})`}
                description={
                  <>
                    The {planDisplayName(limitDecision.tier)} plan includes {limitDecision.limit}{" "}
                    sender identities. Archived senders do not count towards the limit — archive
                    one, or move to{" "}
                    {limitDecision.upgradeTier
                      ? planDisplayName(limitDecision.upgradeTier)
                      : "a larger plan"}{" "}
                    to add more.
                  </>
                }
                action={
                  <Link
                    href={pricingUrl()}
                    className="ds-btn ds-btn-primary ds-btn-sm"
                    style={{ textDecoration: "none" }}
                  >
                    <span>View plans</span>
                    <ArrowRight size={12} />
                  </Link>
                }
              />
            </div>
          )}

          <AddSender
            projectId={projectId}
            verifiedDomains={options.verifiedDomains}
            gmailTransports={options.gmailTransports}
            disabled={!limitDecision.allowed}
            limit={
              limitDecision
                ? { used: limitDecision.used, limit: limitDecision.limit, tier: limitDecision.tier }
                : null
            }
          />
        </>
      )}
    </div>
  );
}
