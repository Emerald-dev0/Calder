import Link from "next/link";
import { fmtAgo, fmtInt, fmtMoney, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  auditRows,
  billingOverview,
  customerTotals,
  dbHealth,
  emailTotals,
  evaluateAlerts,
  pipelineDaily,
  queueDerived,
  redisHealth,
  waitlistOverview,
} from "@/lib/control/queries";
import { AreaChart, BarsChart } from "./_components/charts";
import { Badge, Dot, KV, Panel, Stat } from "./_components/ui";

export const dynamic = "force-dynamic";

function greeting(): string {
  const h = new Date().getUTCHours();
  if (h < 11) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function CommandCenter() {
  const ctx = await requireSection("overview");
  const [customers, billing, waitlist, today, week, pipeline, redis, db, queue, alerts, audit] = await Promise.all([
    customerTotals(),
    billingOverview(),
    waitlistOverview(),
    emailTotals(1),
    emailTotals(7),
    pipelineDaily(14),
    redisHealth(),
    dbHealth(),
    queueDerived(),
    evaluateAlerts(),
    auditRows({ page: 1 }),
  ]);

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warnings = alerts.filter((a) => a.severity === "warning").length;
  const statusLine =
    critical > 0
      ? `${critical} critical alert${critical === 1 ? " needs" : "s need"} attention.`
      : warnings > 0
        ? `${warnings} warning${warnings === 1 ? "" : "s"} — mostly stable.`
        : "Everything looks healthy.";

  const mrrDelta = null; // MRR trend needs subscription history; shown on Billing → Revenue.
  const waitlistGrowth =
    waitlist.prev7d > 0 ? ((waitlist.new7d - waitlist.prev7d) / waitlist.prev7d) * 100 : null;

  return (
    <>
      <div className="cp-greet">
        <h1>
          {greeting()}, {ctx.user.name?.split(" ")[0] ?? ctx.email.split("@")[0]}.
        </h1>
        <p style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Dot tone={critical > 0 ? "bad" : warnings > 0 ? "warn" : "ok"} />
          {statusLine}
          <span style={{ color: "var(--cp-faint)" }}>· Live queries, updated just now</span>
        </p>
      </div>

      {alerts.length > 0 ? (
        <Panel
          title="Alerts"
          caption="Rules evaluated live against current platform state"
          action={
            <Link className="cp-btn" href="/control/observability/alerts">
              All alerts
            </Link>
          }
          flush
        >
          {alerts.slice(0, 5).map((a) => (
            <div className="cp-alert" key={a.id}>
              <Dot tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"} />
              <div style={{ minWidth: 0 }}>
                <div className="cp-alert-title">{a.title}</div>
                <div className="cp-alert-detail">{a.detail}</div>
              </div>
              <Link className="cp-alert-metric mono" href={a.href}>
                {a.metric} →
              </Link>
            </div>
          ))}
        </Panel>
      ) : null}

      <p className="cp-eyebrow" style={{ margin: "4px 0 10px" }}>
        Business
      </p>
      <div className="cp-stats">
        <Stat label="MRR" value={fmtMoney(billing.mrrCents)} delta={mrrDelta} hint="active subscriptions" />
        <Stat label="Customers" value={fmtInt(billing.activeCount)} hint="paying organizations" />
        <Stat label="Organizations" value={fmtInt(customers.orgs)} hint={`${fmtInt(customers.projectsCount)} projects`} />
        <Stat label="Users" value={fmtInt(customers.total)} delta={customers.new7d > 0 ? ((customers.new7d / Math.max(customers.total - customers.new7d, 1)) * 100) : null} hint={`+${fmtInt(customers.new7d)} this week`} />
      </div>

      <p className="cp-eyebrow" style={{ margin: "4px 0 10px" }}>
        Growth
      </p>
      <div className="cp-stats">
        <Stat label="Waitlist" value={fmtInt(waitlist.total)} delta={waitlistGrowth} hint={`+${fmtInt(waitlist.new7d)} this week`} />
        <Stat label="New today (waitlist)" value={fmtInt(waitlist.newToday)} hint="since 00:00 UTC" />
        <Stat label="Conversion" value={fmtPct(waitlist.total ? (waitlist.converted / waitlist.total) * 100 : 0)} hint={`${fmtInt(waitlist.converted)} joined Calder`} />
        <Stat label="Referral rate" value={fmtPct(waitlist.total ? (waitlist.referred / waitlist.total) * 100 : 0)} hint="joined via a referral" />
      </div>

      <p className="cp-eyebrow" style={{ margin: "4px 0 10px" }}>
        Communication
      </p>
      <div className="cp-stats">
        <Stat label="Emails today" value={fmtInt(today.total)} hint="accepted into the pipeline" />
        <Stat label="Delivered (7d)" value={fmtInt(week.delivered)} hint={`${fmtInt(week.bounced + week.complained + week.failed)} failed/bounced`} />
        <Stat
          label="Delivery rate (7d)"
          value={week.deliveryRate === null ? "—" : fmtPct(week.deliveryRate)}
          hint="terminal outcomes only"
        />
        <Stat label="Queued now" value={fmtInt(today.queued + today.sending)} hint="created + queued + sending" />
      </div>

      <p className="cp-eyebrow" style={{ margin: "4px 0 10px" }}>
        Infrastructure
      </p>
      <div className="cp-stats">
        <div className="cp-stat">
          <p className="cp-stat-label">Database</p>
          <p className="cp-stat-value" style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Dot tone={db.reachable ? "ok" : "bad"} /> {db.reachable ? "Healthy" : "Unreachable"}
          </p>
          <p className="cp-stat-foot">
            {db.latencyMs !== null ? `${db.latencyMs}ms · ${fmtInt(db.connections ?? 0)} conns` : "no response"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Redis</p>
          <p className="cp-stat-value" style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Dot tone={redis.reachable ? "ok" : "warn"} /> {redis.reachable ? "Healthy" : "Unreachable"}
          </p>
          <p className="cp-stat-foot">
            {redis.reachable && redis.opsPerSec !== null ? `${fmtInt(redis.opsPerSec)} ops/s` : "queue falls back to Postgres state"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Queue</p>
          <p className="cp-stat-value" style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Dot tone={queue.inFlight > 5000 || (queue.oldestAgeMinutes ?? 0) > 15 ? "warn" : "ok"} />
            {queue.inFlight > 0 ? fmtInt(queue.inFlight) : "Empty"}
          </p>
          <p className="cp-stat-foot">
            {queue.oldestAgeMinutes !== null ? `oldest ${queue.oldestAgeMinutes}m` : "nothing waiting"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Alerts</p>
          <p className="cp-stat-value" style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Dot tone={critical > 0 ? "bad" : warnings > 0 ? "warn" : "ok"} />
            {alerts.length === 0 ? "None firing" : `${critical} critical · ${warnings} warn`}
          </p>
          <p className="cp-stat-foot">
            <Link href="/control/observability/alerts" style={{ color: "inherit" }}>
              view rules →
            </Link>
          </p>
        </div>
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Sends per day" caption="accepted sends · last 14 days">
          <BarsChart
            data={pipeline.map((p) => ({ label: p.day, value: p.created }))}
            caption="emails accepted / day"
          />
        </Panel>
        <Panel title="Delivered per day" caption="terminal delivered · last 14 days">
          <AreaChart
            data={pipeline.map((p) => ({ label: p.day, value: p.delivered }))}
            caption="emails delivered / day"
          />
        </Panel>
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel
          title="Recent operator actions"
          caption="audit trail · newest first"
          action={
            <Link className="cp-btn" href="/control/administration/audit-logs">
              Audit logs
            </Link>
          }
          flush
        >
          {audit.rows.length === 0 ? (
            <div className="cp-empty">
              <b>Nothing audited yet</b>
              Operator actions land here automatically.
            </div>
          ) : (
            audit.rows.slice(0, 8).map(({ audit: a, actorEmail }) => (
              <div className="cp-alert" key={a.id}>
                <Dot tone="info" />
                <div>
                  <div className="cp-alert-title mono" style={{ fontSize: 12.5 }}>
                    {a.action}
                  </div>
                  <div className="cp-alert-detail">
                    {actorEmail ?? "system"} → {a.targetType ?? "—"} {a.targetId ? <span className="mono">{a.targetId.slice(0, 24)}</span> : null}
                  </div>
                </div>
                <span className="cp-alert-metric mono">{fmtAgo(new Date(a.createdAt))}</span>
              </div>
            ))
          )}
        </Panel>

        <Panel title="Platform state" caption="live dependency snapshot">
          <KV k="Postgres" v={db.reachable ? `${db.version} · ${db.latencyMs}ms` : "unreachable"} mono />
          <KV
            k="Redis"
            v={redis.reachable ? `v${redis.version ?? "?"} · ${fmtInt(redis.opsPerSec ?? 0)} ops/s` : "unreachable"}
            mono
          />
          <KV k="DB size" v={db.sizeBytes !== null ? `${(db.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—"} mono />
          <KV
            k="DB connections"
            v={db.connections !== null && db.maxConnections ? `${db.connections} / ${db.maxConnections}` : "—"}
            mono
          />
          <KV
            k="Delivery rate (7d)"
            v={week.deliveryRate === null ? "—" : fmtPct(week.deliveryRate)}
            mono
          />
          <KV k="Past-due subs" v={fmtInt(billing.pastDueCount)} mono />
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge tone="accent">Founder = all operator permissions</Badge>
            <Link className="cp-btn" href="/control/customers/organizations">
              Inspect customers
            </Link>
            <Link className="cp-btn" href="/control/growth/waitlist">
              Waitlist
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
