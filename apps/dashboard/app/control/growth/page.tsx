import nextDynamic from "next/dynamic";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  conversionsDaily,
  conversionsInWindow,
  ctaBreakdown,
  ctaImpressions,
  countryBreakdown,
  sourceBreakdown,
  topPages,
  trafficDailySeries,
  trafficTotals,
  waitlistCountryInWindow,
  waitlistDailyInWindow,
  waitlistSourceInWindow,
  waitlistWindowCounts,
} from "@/lib/control/analytics-queries";
import {
  compareWindow,
  denseDailyFromWindow,
  fmtDeltaPp,
  fmtDeltaPct,
  fmtDuration,
  parseRange,
  pctChange,
  ppChange,
} from "@/lib/control/range";
import {
  Empty,
  InsightList,
  PageHeader,
  Panel,
  SectionLabel,
  Stat,
} from "@/control/_components/ui";
import { FounderTopbar } from "@/control/_components/founder-topbar";

const TrendChart = nextDynamic(() => import("@/components/charts").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <div style={{ height: 340 }} />,
});
const ActivityHeatmap = nextDynamic(
  () => import("@/components/charts").then((m) => m.ActivityHeatmap),
  {
    ssr: false,
  }
);

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  referral: "Referral",
  direct: "Direct",
};

const CTA_LABELS: Record<string, string> = {
  join_waitlist: "Join waitlist",
  start_free: "Start free",
  view_pricing: "View pricing",
  read_docs: "Read docs",
  sign_in: "Sign in",
  developers: "Developers",
};

export default async function GrowthOverviewPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string };
}) {
  await requireSection("growth");
  const window = parseRange(searchParams.range, searchParams.from, searchParams.to);
  const prev = compareWindow(window);

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const [
    traffic,
    trafficPrev,
    series,
    wlWin,
    wlDaily,
    convDaily,
    convTotal,
    convPrev,
    ctas,
    sources,
    sourcesPrev,
    countries,
    wlCountries,
    wlSources,
    pages,
  ] = await Promise.all([
    safe(trafficTotals(window), null),
    safe(trafficTotals(prev), null),
    safe(trafficDailySeries(window), []),
    safe(waitlistWindowCounts(window), { current: 0, previous: null }),
    safe(waitlistDailyInWindow(window), []),
    safe(conversionsDaily(window), []),
    safe(conversionsInWindow(window), 0),
    safe(conversionsInWindow(prev), 0),
    safe(ctaBreakdown(window), []),
    safe(sourceBreakdown(window), []),
    safe(sourceBreakdown(prev), []),
    safe(countryBreakdown(window), []),
    safe(waitlistCountryInWindow(window), []),
    safe(waitlistSourceInWindow(window), []),
    safe(topPages(window), []),
  ]);
  const impressions = await safe(
    ctaImpressions(window, Object.keys(CTA_LABELS)),
    new Map<string, number>()
  );

  const now = new Date();
  const wlDense = denseDailyFromWindow(window, wlDaily, now);
  const convDense = denseDailyFromWindow(window, convDaily, now);

  // Merge chart series by day.
  const dayMap = new Map<
    string,
    {
      day: string;
      visitors: number;
      sessions: number;
      clicks: number;
      submissions: number;
      confirmed: number;
    }
  >();
  for (const r of series)
    dayMap.set(r.day, {
      day: r.day,
      visitors: r.visitors,
      sessions: r.sessions,
      clicks: r.clicks,
      submissions: 0,
      confirmed: 0,
    });
  for (const r of wlDense) {
    const row = dayMap.get(r.day) ?? {
      day: r.day,
      visitors: 0,
      sessions: 0,
      clicks: 0,
      submissions: 0,
      confirmed: 0,
    };
    row.submissions = r.count;
    dayMap.set(r.day, row);
  }
  for (const r of convDense) {
    const row = dayMap.get(r.day) ?? {
      day: r.day,
      visitors: 0,
      sessions: 0,
      clicks: 0,
      submissions: 0,
      confirmed: 0,
    };
    row.confirmed = r.count;
    dayMap.set(r.day, row);
  }
  const chartData = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day));

  const hasTrafficData = traffic?.hasData ?? false;
  const visitors = traffic?.visitors ?? 0;
  const sessions = traffic?.sessions ?? 0;
  const pageviews = traffic?.pageviews ?? 0;
  const clicks = traffic?.ctaClicks ?? 0;
  const submissions = wlWin.current;
  const confirmed = convTotal;

  // Deltas (REQ-091): counts get %, rates get pp. Each labeled with basis.
  const dVisitors = hasTrafficData ? pctChange(visitors, trafficPrev?.visitors ?? 0) : null;
  const dSessions = hasTrafficData ? pctChange(sessions, trafficPrev?.sessions ?? 0) : null;
  const dSubmissions = pctChange(submissions, wlWin.previous ?? 0);
  const convRate = visitors > 0 ? (confirmed / visitors) * 100 : null;
  const convRatePrev =
    trafficPrev && (trafficPrev.visitors ?? 0) > 0 && convPrev !== null
      ? ((convPrev ?? 0) / trafficPrev.visitors) * 100
      : null;
  const dConvRate = ppChange(convRate, convRatePrev);

  // Velocity (REQ-035).
  const dayValues = wlDense.map((d) => d.count);
  const avgDaily = dayValues.length ? dayValues.reduce((a, b) => a + b, 0) / dayValues.length : 0;
  const half = Math.floor(dayValues.length / 2);
  const firstHalf = dayValues.slice(0, half).reduce((a, b) => a + b, 0);
  const secondHalf = dayValues.slice(half).reduce((a, b) => a + b, 0);
  const wow = half > 0 ? pctChange(secondHalf, firstHalf) : null;
  const best = wlDense.reduce<{ day: string; count: number } | null>(
    (acc, d) => (!acc || d.count > acc.count ? d : acc),
    null
  );
  const lowest = wlDense.reduce<{ day: string; count: number } | null>(
    (acc, d) => (!acc || d.count < acc.count ? d : acc),
    null
  );

  // Best periods (REQ-044).
  const trafficByDay = series.map((r) => ({ day: r.day, value: r.visitors }));
  const bestTraffic = trafficByDay.reduce<{ day: string; value: number } | null>(
    (acc, d) => (!acc || d.value > acc.value ? d : acc),
    null
  );
  const bestSubmissions = wlDense.reduce<{ day: string; count: number } | null>(
    (acc, d) => (!acc || d.count > acc.count ? d : acc),
    null
  );

  // Engagement (REQ-041) — bounce intentionally absent: no session semantics yet.
  const returningShare =
    traffic && traffic.visitors > 0 ? (traffic.returningVisitors / traffic.visitors) * 100 : null;

  // Funnel + drop-off (REQ-036).
  const funnel = [
    { label: "Visitors", value: visitors },
    { label: "CTA clicks", value: clicks },
    { label: "Submissions", value: submissions },
    { label: "Confirmed", value: confirmed },
  ];

  // Notable changes (REQ-046) — data-driven only.
  const notes: string[] = [];
  const linkedin = sources.find((s) => s.source === "linkedin");
  const linkedinPrev = sourcesPrev.find((s) => s.source === "linkedin");
  if (linkedin && linkedinPrev && linkedinPrev.visitors > 0) {
    const delta = pctChange(linkedin.visitors, linkedinPrev.visitors);
    if (delta !== null && Math.abs(delta) >= 15) {
      notes.push(
        `Traffic from LinkedIn ${delta > 0 ? "increased" : "decreased"} ${Math.abs(delta).toFixed(0)}% versus the previous period.`
      );
    }
  }
  if (bestSubmissions) {
    notes.push(
      `Waitlist submissions peaked on ${bestSubmissions.day} (${fmtInt(bestSubmissions.count)} in a day).`
    );
  }
  const topCountry = wlCountries[0];
  if (topCountry && submissions > 0) {
    notes.push(
      `${topCountry.country} accounts for ${Math.round((topCountry.submissions / submissions) * 100)}% of new submissions this period.`
    );
  }
  if (dConvRate !== null) {
    notes.push(
      `Visitor → confirmed conversion ${dConvRate >= 0 ? "improved" : "declined"} from ${convRatePrev !== null ? fmtPct(convRatePrev) : "—"} to ${convRate !== null ? fmtPct(convRate) : "—"}.`
    );
  }

  // Acquisition table: event-layer traffic + signup-time sources joined.
  const sourceRows = Array.from(
    new Set([...sources.map((s) => s.source), ...(wlSources ?? []).map((s) => s.source)])
  ).map((src) => {
    const ev = sources.find((s) => s.source === src);
    const wl = (wlSources ?? []).find((s) => s.source === src);
    return {
      source: src,
      visitors: ev?.visitors ?? null,
      clicks: ev?.clicks ?? null,
      submissions: wl?.submissions ?? 0,
    };
  });

  return (
    <>
      <FounderTopbar
        title="Growth"
        context="Understand how people discover, interact, and convert"
        rangeKey={window.key}
        customFrom={searchParams.from}
        customTo={searchParams.to}
      />
      <main className="cp-content">
        <PageHeader
          eyebrow="Growth"
          title="How Calder is growing"
          subtitle="Where people come from, what they do, and what turns a visit into a signup."
        />

        <SectionLabel
          right={
            <span className="cp-caption" style={{ margin: 0 }}>
              {window.compareLabel}
            </span>
          }
        >
          Core growth
        </SectionLabel>
        <div className="cp-stats">
          <Stat
            label="Visitors"
            value={hasTrafficData ? fmtInt(visitors) : "—"}
            delta={dVisitors}
            basis={window.compareLabel}
            hint={
              hasTrafficData
                ? "unique visitors in range"
                : "first-party analytics is collecting its first data"
            }
            spark={series.slice(-14).map((r) => r.visitors)}
          />
          <Stat
            label="Sessions"
            value={hasTrafficData ? fmtInt(sessions) : "—"}
            delta={dSessions}
            basis={window.compareLabel}
            hint={
              hasTrafficData
                ? `${fmtInt(pageviews)} pageviews`
                : "sessions begin accruing with traffic"
            }
          />
          <Stat
            label="Submissions"
            value={fmtInt(submissions)}
            delta={dSubmissions}
            basis={window.compareLabel}
            hint="completed waitlist submissions"
            spark={wlDense.slice(-14).map((d) => d.count)}
          />
          <Stat
            label="Confirmed"
            value={fmtInt(confirmed)}
            delta={pctChange(confirmed, convPrev)}
            basis={window.compareLabel}
            hint="now hold accounts"
          />
          <Stat
            label="Visitor → confirmed"
            value={convRate !== null ? fmtPct(convRate) : "—"}
            hint={
              dConvRate !== null
                ? `${fmtDeltaPp(dConvRate)} ${window.compareLabel.replace("vs ", "")}`
                : "rate needs visitor data"
            }
          />
        </div>

        <SectionLabel>Growth over time</SectionLabel>
        <Panel
          title="Growth over time"
          caption="Toggle series · hover for per-day detail · comparison basis shown on each metric"
        >
          <TrendChart
            data={chartData}
            height={340}
            series={[
              { key: "visitors", label: "Visitors", color: "#0b0c0e" },
              { key: "sessions", label: "Sessions", color: "#3d5afe" },
              { key: "clicks", label: "CTA clicks", color: "#a3a094" },
              { key: "submissions", label: "Submissions", color: "#7c86f8" },
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
          <Panel
            title="Growth velocity"
            caption={`Momentum within this window · ${window.compareLabel}`}
          >
            <Stat
              label="Week over week (window halves)"
              value={wow !== null ? fmtDeltaPct(wow) : "—"}
              hint="second half vs first half"
            />
            <Stat
              label="Average daily submissions"
              value={avgDaily.toFixed(1)}
              hint="across the selected range"
            />
            <Stat
              label="Best day"
              value={best ? fmtInt(best.count) : "—"}
              hint={best ? `${best.day} · most submissions` : "no submissions in range"}
            />
            <Stat
              label="Lowest day"
              value={lowest ? fmtInt(lowest.count) : "—"}
              hint={lowest ? `${lowest.day} · fewest submissions` : "no submissions in range"}
            />
            <div style={{ height: 10 }} />
            <Panel title="Daily activity" caption="Submissions per day · hover for detail" flush>
              <div style={{ padding: "14px 16px" }}>
                <ActivityHeatmap data={wlDense.map((d) => ({ day: d.day, value: d.count }))} />
              </div>
            </Panel>
            <div style={{ height: 10 }} />
            <Panel title="Best performing periods" caption="Where the peaks actually are" flush>
              <div style={{ padding: "6px 0 2px" }}>
                <Stat
                  label="Highest traffic day"
                  value={bestTraffic ? fmtInt(bestTraffic.value) : "—"}
                  hint={bestTraffic ? bestTraffic.day : "needs traffic data"}
                />
                <Stat
                  label="Highest signup day"
                  value={bestSubmissions ? fmtInt(bestSubmissions.count) : "—"}
                  hint={bestSubmissions ? bestSubmissions.day : "no signups in range"}
                />
              </div>
            </Panel>
          </Panel>

          <Panel
            title="Conversion journey"
            caption="Visitor → confirmed, with the drop-offs made visible"
          >
            {visitors > 0 || submissions > 0 ? (
              <div className="cp-funnel">
                {funnel.map((step, i) => {
                  const prev = i > 0 ? (funnel[i - 1]?.value ?? 0) : null;
                  const rate = prev && prev > 0 ? (step.value / prev) * 100 : null;
                  const lost = i > 0 ? Math.max(0, (funnel[i - 1]?.value ?? 0) - step.value) : null;
                  return (
                    <div className="cp-funnel-step" key={step.label}>
                      <span className="cp-funnel-label">{step.label}</span>
                      <span className="cp-funnel-value">{fmtInt(step.value)}</span>
                      <span className="cp-funnel-meta">
                        {i > 0
                          ? rate !== null
                            ? `${fmtPct(rate)} of previous step · ${fmtInt(lost ?? 0)} lost before this stage`
                            : "no upstream data yet"
                          : convRate !== null
                            ? `${fmtPct(convRate)} overall visitor → confirmed`
                            : "overall conversion needs visitor data"}
                      </span>
                      <span className="cp-funnel-track">
                        <span
                          className="cp-funnel-fill"
                          style={{ width: `${Math.max(2, rate ?? 100)}%` }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty title="Growth data will appear here">
                Once visitors start interacting with Calder, the journey from visit to confirmed
                shows here.
              </Empty>
            )}
          </Panel>
        </div>

        <SectionLabel>Acquisition & geography</SectionLabel>
        <div className="cp-grid cp-grid-2">
          <Panel
            title="Where growth comes from"
            caption="Traffic from the event layer; submissions captured at signup"
          >
            {sourceRows.length === 0 ? (
              <Empty title="No source data yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th className="cp-num">Visitors</th>
                      <th className="cp-num">Clicks</th>
                      <th className="cp-num">Submissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((r) => (
                      <tr key={r.source}>
                        <td>{SOURCE_LABELS[r.source] ?? r.source}</td>
                        <td className="cp-num">{r.visitors === null ? "—" : fmtInt(r.visitors)}</td>
                        <td className="cp-num">{r.clicks === null ? "—" : fmtInt(r.clicks)}</td>
                        <td className="cp-num">{fmtInt(r.submissions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Where growth is happening" caption="Country-level aggregates only">
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
                        <td className="cp-num">
                          {fmtInt(
                            wlCountries.find((w) => w.country === c.country)?.submissions ?? 0
                          )}
                        </td>
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

        <SectionLabel>Content & behavior</SectionLabel>
        <div className="cp-grid cp-grid-2">
          <Panel title="What people are looking at" caption="Top public pages by views">
            {pages.length === 0 ? (
              <Empty title="No page data yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th className="cp-num">Views</th>
                      <th className="cp-num">Visitors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((p) => (
                      <tr key={p.path}>
                        <td className="mono" style={{ fontSize: 12.5 }}>
                          {p.path}
                        </td>
                        <td className="cp-num">{fmtInt(p.views)}</td>
                        <td className="cp-num">{fmtInt(p.visitors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="What people are doing" caption="CTA performance with impression context">
            {ctas.length === 0 ? (
              <Empty title="No CTA data yet" />
            ) : (
              <div>
                {ctas.map((c) => {
                  const impressionsFor = impressions.get(c.label) ?? 0;
                  const ctr = impressionsFor > 0 ? (c.clicks / impressionsFor) * 100 : null;
                  return (
                    <div className="cp-kv" key={c.label}>
                      <span className="k">
                        {CTA_LABELS[c.label] ?? c.label}
                        <span style={{ color: "var(--cp-faint)", marginLeft: 6, fontSize: 11.5 }}>
                          {impressionsFor > 0
                            ? `${fmtInt(impressionsFor)} impressions`
                            : "impressions pending"}
                          {ctr !== null ? ` · ${fmtPct(ctr)} CTR` : ""}
                        </span>
                      </span>
                      <span className="v mono">{fmtInt(c.clicks)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <SectionLabel>Engagement</SectionLabel>
        <div className="cp-stats">
          <Stat
            label="Avg session duration"
            value={
              traffic?.avgSessionSeconds != null ? fmtDuration(traffic.avgSessionSeconds) : "—"
            }
            hint="sessions with multiple pageviews"
          />
          <Stat
            label="Pages / session"
            value={traffic?.pagesPerSession != null ? traffic.pagesPerSession.toFixed(1) : "—"}
            hint="pageviews over sessions"
          />
          <Stat
            label="Returning visitors"
            value={returningShare !== null ? fmtPct(returningShare) : "—"}
            hint="seen in a previous period"
          />
          <Stat
            label="Bounce rate"
            value="—"
            hint="not yet reliably defined — shown only when it is"
          />
        </div>

        <SectionLabel>Notable changes</SectionLabel>
        {notes.length > 0 ? (
          <Panel flush>
            <InsightList items={notes} />
          </Panel>
        ) : (
          <Empty title="Nothing notable this period">
            Observations appear here when the data shows a real shift worth your attention.
          </Empty>
        )}

        <p className="cp-caption">
          Comparisons are {window.compareLabel.replace("vs ", "")}. Dashes mean the metric does not
          exist yet — never a fabricated value.
        </p>
      </main>
    </>
  );
}
