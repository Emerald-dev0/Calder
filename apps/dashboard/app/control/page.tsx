import Link from "next/link";
import nextDynamic from "next/dynamic";
import { fmtAgo, fmtInt, fmtMoney, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  billingOverview,
  customerTotals,
  dbHealth,
  evaluateAlerts,
  queueDerived,
  redisHealth,
  waitlistOverview,
} from "@/lib/control/queries";
import {
  confirmationTotals,
  conversionsDaily,
  conversionsInWindow,
  ctaBreakdown,
  countryBreakdown,
  recentConfirmationEvents,
  sourceBreakdown,
  trafficDailySeries,
  trafficTotals,
  waitlistCountryInWindow,
  waitlistDailyInWindow,
  waitlistWindowCounts,
} from "@/lib/control/analytics-queries";
import { denseDailyFromWindow, fmtDeltaPct, parseRange, pctChange } from "@/lib/control/range";
import { Dot, Empty, InsightList, KV, Panel, SectionLabel, Stat } from "./_components/ui";
import { FounderTopbar } from "./_components/founder-topbar";

const TrendChart = nextDynamic(() => import("@/components/charts").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <div style={{ height: 320 }} />,
});

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  referral: "Referral",
  direct: "Direct",
};

function sparkRows(dense: Array<{ day: string; count: number }>): number[] {
  return dense.slice(-14).map((d) => d.count);
}

export default async function CommandCenter({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string };
}) {
  await requireSection("overview");
  const window = parseRange(searchParams.range, searchParams.from, searchParams.to);

  // Every dataset loads independently so one failure degrades one section
  // (REQ-094), not the page.
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const [traffic, trafficSeries, wl, wlWindow, wlDaily, convDaily, convTotal, ctas, sources, countries, wlCountries, confirm, confirmEvents, alerts, db, redis, queue, billing, customers] =
    await Promise.all([
      safe(trafficTotals(window), null),
      safe(trafficDailySeries(window), []),
      safe(waitlistOverview(), null),
      safe(waitlistWindowCounts(window), { current: 0, previous: null }),
      safe(waitlistDailyInWindow(window), []),
      safe(conversionsDaily(window), []),
      safe(conversionsInWindow(window), 0),
      safe(ctaBreakdown(window), []),
      safe(sourceBreakdown(window), []),
      safe(countryBreakdown(window), []),
      safe(waitlistCountryInWindow(window), []),
      safe(confirmationTotals(window), null),
      safe(recentConfirmationEvents(8), []),
      safe(evaluateAlerts(), []),
      safe(dbHealth(), null),
      safe(redisHealth(), null),
      safe(queueDerived(), null),
      safe(billingOverview(), null),
      safe(customerTotals(), null),
    ]);

  const now = new Date();
  const wlDense = denseDailyFromWindow(window, wlDaily, now);
  const convDense = denseDailyFromWindow(window, convDaily, now);

  // Chart data: merge series by day. Visitors/clicks only exist where the
  // event layer has data (honest zeros otherwise — REQ-083).
  const dayMap = new Map<string, { day: string; visitors: number; clicks: number; submissions: number; confirmed: number }>();
  for (const r of trafficSeries)
    dayMap.set(r.day, { day: r.day, visitors: r.visitors, clicks: r.clicks, submissions: 0, confirmed: 0 });
  for (const r of wlDense) {
    const row = dayMap.get(r.day) ?? { day: r.day, visitors: 0, clicks: 0, submissions: 0, confirmed: 0 };
    row.submissions = r.count;
    dayMap.set(r.day, row);
  }
  for (const r of convDense) {
    const row = dayMap.get(r.day) ?? { day: r.day, visitors: 0, clicks: 0, submissions: 0, confirmed: 0 };
    row.confirmed = r.count;
    dayMap.set(r.day, row);
  }
  const chartData = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day));
  const hasTrafficData = traffic?.hasData ?? false;

  const visitors = traffic?.visitors ?? 0;
  const clicks = traffic?.ctaClicks ?? 0;
  const submissions = wlWindow.current;
  const confirmed = convTotal;
  const overallConv = visitors > 0 ? (confirmed / visitors) * 100 : null;
  const wlDelta = pctChange(wlWindow.current, wlWindow.previous ?? 0);

  const funnel = [
    { label: "Visitors", value: visitors },
    { label: "CTA clicks", value: clicks },
    { label: "Submissions", value: submissions },
    { label: "Confirmed", value: confirmed },
  ];

  // Insights: computed observations only (REQ-027). Rendered only when the
  // data actually supports the claim — never motivational filler.
  const insights: string[] = [];
  const direct = sources.find((s) => s.source === "direct" || s.source === null);
  const topSource = sources
    .filter((s) => s.source !== "direct" && s.source !== null)
    .sort((a, b) => b.clicks - a.clicks)[0];
  if (topSource && direct && direct.clicks > 0 && topSource.clicks > direct.clicks) {
    insights.push(
      `${SOURCE_LABELS[topSource.source] ?? topSource.source} drives the most tracked CTA activity (${fmtInt(topSource.clicks)} clicks), ahead of direct traffic (${fmtInt(direct.clicks)}).`
    );
  }
  const topCountry = wlCountries[0];
  if (topCountry && submissions > 0 && topCountry.submissions / submissions >= 0.4) {
    insights.push(
      `${topCountry.country} accounts for ${Math.round((topCountry.submissions / submissions) * 100)}% of new waitlist submissions in this period.`
    );
  }
  if (confirm?.deliveryRate != null && confirm.hasData) {
    insights.push(
      `Confirmation delivery is ${fmtPct(confirm.deliveryRate)} in this period across ${fmtInt(confirm.sent)} sent.`
    );
  }

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warnings = alerts.filter((a) => a.severity === "warning").length;
  const issueCount = critical + warnings;

  return (
    <>
      <FounderTopbar
        title="Command Center"
        context="Calder platform overview"
        rangeKey={window.key}
        customFrom={searchParams.from}
        customTo={searchParams.to}
      />
      <main className="cp-content">
        <header className="cp-head">
          <p className="cp-eyebrow">Command Center</p>
          <h1 className="cp-title">Calder at a glance</h1>
          <p className="cp-subtitle" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            Everything important happening across the platform ·{" "}
            {issueCount === 0 ? (
              <>
                <Dot tone="ok" /> All systems operational
              </>
            ) : (
              <Link href="/control/observability/alerts" style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Dot tone={critical > 0 ? "bad" : "warn"} /> {issueCount} issue{issueCount === 1 ? "" : "s"} require attention →
              </Link>
            )}
          </p>
        </header>

        {alerts.length > 0 ? (
          <Panel
            title="Attention required"
            caption="Live alert rules — only genuine conditions appear here"
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

        <SectionLabel right={<span className="cp-caption" style={{ margin: 0 }}>{window.compareLabel}</span>}>
          Primary metrics
        </SectionLabel>
        <div className="cp-stats">
          <Stat
            label="Visitors"
            value={hasTrafficData ? fmtInt(visitors) : "—"}
            hint={hasTrafficData ? `${fmtInt(traffic?.sessions ?? 0)} sessions` : "first-party analytics is collecting its first data"}
          />
          <Stat
            label="Waitlist"
            value={fmtInt(wl?.total ?? 0)}
            delta={wlDelta}
            basis={window.compareLabel}
            hint={`${fmtInt(submissions)} joined in this period`}
            spark={sparkRows(wlDense)}
          />
          <Stat label="Submissions" value={fmtInt(submissions)} hint={`${fmtInt(wl?.newToday ?? 0)} today`} />
          <Stat
            label="Confirmed"
            value={fmtInt(confirmed)}
            hint={visitors > 0 ? `${fmtPct(overallConv ?? 0)} visitor → confirmed` : "conversion needs visitor data"}
          />
          <Stat
            label="Confirmation emails"
            value={confirm && confirm.hasData ? fmtInt(confirm.sent) : "—"}
            hint={confirm?.deliveryRate != null ? `${fmtPct(confirm.deliveryRate)} delivered` : "no sends in this window"}
          />
        </div>

        <SectionLabel>Business</SectionLabel>
        <div className="cp-stats">
          <Stat label="MRR" value={billing ? fmtMoney(billing.mrrCents) : "—"} hint="active subscriptions" />
          <Stat label="Customers" value={billing ? fmtInt(billing.activeCount) : "—"} hint="paying organizations" />
          <Stat label="Organizations" value={customers ? fmtInt(customers.orgs) : "—"} hint={customers ? `${fmtInt(customers.projectsCount)} projects` : undefined} />
          <Stat label="Users" value={customers ? fmtInt(customers.total) : "—"} hint={customers ? `+${fmtInt(customers.new7d)} this week` : undefined} />
        </div>

        <SectionLabel>Growth</SectionLabel>
        <Panel title="Growth" caption="Visitors, engagement, and conversions over time · toggle series, hover for detail">
          <TrendChart
            data={chartData}
            series={[
              { key: "visitors", label: "Visitors", color: "#0b0c0e" },
              { key: "clicks", label: "CTA clicks", color: "#3d5afe" },
              { key: "submissions", label: "Submissions", color: "#a3a094" },
              { key: "confirmed", label: "Confirmed", color: "#1f9d5b" },
            ]}
            footer={(row: Record<string, string | number>) =>
              Number(row.visitors ?? 0) > 0
                ? `Conversion that day: ${fmtPct((Number(row.confirmed ?? 0) / Number(row.visitors)) * 100)}`
                : null
            }
          />
        </Panel>

        <div className="cp-grid cp-grid-2">
          <Panel title="Conversion" caption="From visit to confirmed user">
            <div className="cp-funnel">
              {funnel.map((step, i) => {
                const prev = i > 0 ? funnel[i - 1]?.value ?? 0 : null;
                const rate = prev && prev > 0 ? (step.value / prev) * 100 : null;
                return (
                  <div className="cp-funnel-step" key={step.label}>
                    <span className="cp-funnel-label">{step.label}</span>
                    <span className="cp-funnel-value">{fmtInt(step.value)}</span>
                    <span className="cp-funnel-meta">
                      {i > 0
                        ? rate !== null
                          ? `${fmtPct(rate)} of previous step`
                          : "no upstream data yet"
                        : overallConv !== null
                          ? `${fmtPct(overallConv)} overall visitor → confirmed`
                          : "overall conversion needs visitor data"}
                    </span>
                    <span className="cp-funnel-track">
                      <span className="cp-funnel-fill" style={{ width: `${Math.max(2, rate ?? 100)}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="What people are clicking" caption="Tracked public actions">
            {ctas.length === 0 ? (
              <Empty title="No CTA data yet">
                CTA clicks flow in from the first-party analytics beacon once visitors arrive.
              </Empty>
            ) : (
              <div>
                {ctas.map((c) => (
                  <KV key={c.label} k={c.label} v={fmtInt(c.clicks)} mono />
                ))}
              </div>
            )}
          </Panel>
        </div>

        <SectionLabel>Acquisition</SectionLabel>
        <div className="cp-grid cp-grid-2">
          <Panel title="Where they came from" caption="First-party analytics, by declared source">
            {sources.length === 0 ? (
              <Empty title="No source data yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th className="cp-num">Visitors</th>
                      <th className="cp-num">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.source}>
                        <td>{SOURCE_LABELS[s.source] ?? s.source}</td>
                        <td className="cp-num">{fmtInt(s.visitors)}</td>
                        <td className="cp-num">{fmtInt(s.clicks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Where people are discovering Calder" caption="Country-level aggregates only — never individual location">
            {countries.length === 0 && wlCountries.length === 0 ? (
              <Empty title="No geography data yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>Country</th>
                      <th className="cp-num">Visitors</th>
                      <th className="cp-num">Submissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countries.map((c) => (
                      <tr key={`t-${c.country}`}>
                        <td>{c.country}</td>
                        <td className="cp-num">{fmtInt(c.visitors)}</td>
                        <td className="cp-num">{fmtInt(wlCountries.find((w) => w.country === c.country)?.submissions ?? 0)}</td>
                      </tr>
                    ))}
                    {wlCountries
                      .filter((w) => !countries.some((c) => c.country === w.country))
                      .map((w) => (
                        <tr key={`w-${w.country}`}>
                          <td>{w.country}</td>
                          <td className="cp-num">—</td>
                          <td className="cp-num">{fmtInt(w.submissions)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <SectionLabel>Waitlist & confirmation</SectionLabel>
        <div className="cp-grid cp-grid-2">
          <Panel
            title="Waitlist"
            caption="Everyone who has raised their hand for Calder"
            action={
              <Link className="cp-btn" href="/control/growth/waitlist">
                View waitlist →
              </Link>
            }
          >
            <KV k="Total people" v={fmtInt(wl?.total ?? 0)} mono />
            <KV k="New today" v={fmtInt(wl?.newToday ?? 0)} mono />
            <KV
              k="New this week"
              v={fmtInt(wl?.new7d ?? 0)}
              mono
              hint={wlDelta !== null ? fmtDeltaPct(wlDelta) : undefined}
            />
            <KV k="Converted" v={fmtInt(wl?.converted ?? 0)} mono hint="hold Calder accounts" />
          </Panel>

          <Panel
            title="Confirmation email"
            caption="The message people receive after joining the waitlist"
            action={
              <Link className="cp-btn primary" href="/control/email-editor">
                Edit confirmation email →
              </Link>
            }
          >
            {confirm && confirm.hasData ? (
              <>
                <div className="cp-pipeline">
                  <div className="cp-pipe-stage">
                    <div className="cp-pipe-num">{fmtInt(confirm.sent)}</div>
                    <div className="cp-pipe-label">Sent</div>
                  </div>
                  <div className="cp-pipe-stage ok">
                    <div className="cp-pipe-num">{fmtInt(confirm.delivered)}</div>
                    <div className="cp-pipe-label">Delivered</div>
                  </div>
                  <div className={`cp-pipe-stage ${confirm.failed + confirm.bounced > 0 ? "bad" : ""}`}>
                    <div className="cp-pipe-num">{fmtInt(confirm.failed + confirm.bounced)}</div>
                    <div className="cp-pipe-label">Failed</div>
                  </div>
                  <div className="cp-pipe-stage">
                    <div className="cp-pipe-num">{confirm.deliveryRate !== null ? fmtPct(confirm.deliveryRate) : "—"}</div>
                    <div className="cp-pipe-label">Rate</div>
                  </div>
                </div>
                <p className="cp-caption" style={{ margin: "10px 0 0" }}>
                  Opened / clicked: not tracked — shown only if tracking exists. Never estimated.
                </p>
              </>
            ) : (
              <Empty title="No confirmation emails in this window">
                Send volume appears here once the waitlist is active in this period.
              </Empty>
            )}
          </Panel>
        </div>

        <SectionLabel>Operations</SectionLabel>
        <div className="cp-grid cp-grid-2">
          <Panel title="Recent activity" caption="Confirmation events — newest first" flush>
            {confirmEvents.length === 0 ? (
              <Empty title="Nothing yet">Live events land here as they happen.</Empty>
            ) : (
              confirmEvents.map((e, i) => (
                <div className="cp-alert" key={i}>
                  <Dot tone={e.status === "delivered" ? "ok" : e.status === "failed" || e.status === "bounced" ? "bad" : "warn"} />
                  <div style={{ minWidth: 0 }}>
                    <div className="cp-alert-title">
                      {e.status === "delivered"
                        ? "Confirmation delivered"
                        : e.status === "failed"
                          ? "Confirmation failed"
                          : e.status === "bounced"
                            ? "Confirmation bounced"
                            : "Confirmation in flight"}
                    </div>
                    <div className="cp-alert-detail mono">{e.email}</div>
                  </div>
                  <span className="cp-alert-metric mono">{fmtAgo(e.createdAt, now)}</span>
                </div>
              ))
            )}
          </Panel>

          <Panel title="Platform health" caption="Live dependency snapshot" flush>
            <div className="cp-healthrow">
              <Dot tone={db?.reachable ? "ok" : "bad"} />
              <span className="cp-health-name">Database</span>
              <span className="cp-health-state mono">{db?.reachable ? `${db.latencyMs ?? "?"}ms` : "unreachable"}</span>
            </div>
            <div className="cp-healthrow">
              <Dot tone={redis?.reachable ? "ok" : "warn"} />
              <span className="cp-health-name">Redis</span>
              <span className="cp-health-state mono">
                {redis?.reachable ? `${fmtInt(redis.opsPerSec ?? 0)} ops/s` : "fallback to Postgres"}
              </span>
            </div>
            <div className="cp-healthrow">
              <Dot tone={(queue?.inFlight ?? 0) > 5000 ? "warn" : "ok"} />
              <span className="cp-health-name">Queue</span>
              <span className="cp-health-state mono">
                {(queue?.inFlight ?? 0) > 0 ? `${fmtInt(queue?.inFlight ?? 0)} in flight` : "empty"}
              </span>
            </div>
            <div className="cp-healthrow">
              <Dot tone={confirm?.deliveryRate != null && confirm.deliveryRate < 99 ? "warn" : "ok"} />
              <span className="cp-health-name">Email delivery</span>
              <span className="cp-health-state mono">{confirm?.deliveryRate != null ? fmtPct(confirm.deliveryRate) : "—"}</span>
            </div>
            <div style={{ padding: "10px 16px" }}>
              <Link className="cp-btn" href="/control/infrastructure">
                Infrastructure →
              </Link>
            </div>
          </Panel>
        </div>

        {insights.length > 0 ? (
          <>
            <SectionLabel>Worth knowing</SectionLabel>
            <Panel flush>
              <InsightList items={insights} />
            </Panel>
          </>
        ) : null}

        <p className="cp-caption">
          Every number on this page is a live query; dashes mean the data does not exist yet, never a
          fabricated value. Comparisons are {window.compareLabel.replace("vs ", "")}.
        </p>
      </main>
    </>
  );
}
