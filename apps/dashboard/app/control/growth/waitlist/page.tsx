import Link from "next/link";
import {
  fmtDate,
  fmtInt,
  fmtPct,
  denseDaily,
  cumulative,
  pctChange,
  parseRange,
  rangeToDays,
  topDistribution,
} from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  waitlistDailyCounts,
  waitlistOverview,
  waitlistRows,
  waitlistSources,
  waitlistTopReferrers,
} from "@/lib/control/queries";
import { AreaChart, BarsChart } from "@/control/_components/charts";
import {
  Badge,
  BarList,
  Dot,
  Empty,
  PageHeader,
  Panel,
  Pager,
  RangeTabs,
  Stat,
  Tag,
} from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "warn" | "info" | "idle" | "bad"> = {
  waiting: "idle",
  invited: "info",
  contacted: "warn",
  removed: "bad",
};

interface SearchParams {
  range?: string;
  q?: string;
  source?: string;
  status?: string;
  referred?: string;
  sort?: string;
  page?: string;
}

export default async function WaitlistPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("growth");
  const range = parseRange(searchParams.range);
  const days = rangeToDays(range);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);

  const [overview, daily, sources, topReferrers, table] = await Promise.all([
    waitlistOverview(),
    waitlistDailyCounts(days),
    waitlistSources(),
    waitlistTopReferrers(8),
    waitlistRows({
      q: searchParams.q,
      source: searchParams.source,
      status: searchParams.status,
      referred: searchParams.referred,
      sort: searchParams.sort === "oldest" ? "oldest" : "newest",
      page,
    }),
  ]);

  const dailyDense = denseDaily(daily, days, new Date());
  const cumulativeSeries = cumulative(dailyDense);
  const growthRate = pctChange(overview.new7d, overview.prev7d);
  const conversionPct = overview.total ? (overview.converted / overview.total) * 100 : 0;
  const referralPct = overview.total ? (overview.referred / overview.total) * 100 : 0;
  const sourceBars = topDistribution(sources, 7);

  const filters = {
    q: searchParams.q,
    source: searchParams.source,
    status: searchParams.status,
    referred: searchParams.referred,
    sort: searchParams.sort,
    range: searchParams.range,
  };
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) exportParams.set(k, v);

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Waitlist"
        subtitle="Every person waiting for Calder, live from the signup pipeline. Position, referrals, and conversion are computed — never stored."
        right={
          <>
            <Link
              className="cp-btn"
              href={`/control/growth/waitlist/export?${exportParams.toString()}`}
            >
              Export CSV
            </Link>
            <RangeTabs current={range} basePath="/control/growth/waitlist" />
          </>
        }
      />

      <div
        className="cp-stats"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        <Stat label="Total" value={fmtInt(overview.total)} hint="all-time signups" />
        <Stat label="New today" value={fmtInt(overview.newToday)} hint="since 00:00 UTC" />
        <Stat
          label="New this week"
          value={fmtInt(overview.new7d)}
          delta={growthRate}
          hint="vs previous 7 days"
        />
        <Stat
          label="Conversion"
          value={fmtPct(conversionPct)}
          hint={`${fmtInt(overview.converted)} now have accounts`}
        />
        <Stat
          label="Referral rate"
          value={fmtPct(referralPct)}
          hint={`${fmtInt(overview.referred)} joined via referral`}
        />
        <Stat
          label="Waiting"
          value={fmtInt(overview.waiting)}
          hint={`${fmtInt(overview.invited)} invited · ${fmtInt(overview.contacted)} contacted`}
        />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel
          title="Cumulative waitlist"
          caption={`total signups · last ${range === "all" ? "period (all time)" : range}`}
        >
          <AreaChart
            data={cumulativeSeries.map((p) => ({ label: p.day, value: p.count }))}
            caption="cumulative waitlist size"
          />
        </Panel>
        <Panel
          title="New signups per day"
          caption={`daily signups · last ${range === "all" ? "period (all time)" : range}`}
        >
          <BarsChart
            data={dailyDense.map((p) => ({ label: p.day, value: p.count }))}
            caption="signups / day"
          />
        </Panel>
      </div>

      <div className="cp-grid cp-grid-3">
        <Panel title="Acquisition sources" caption="how people found the waitlist">
          <BarList
            items={sourceBars.map((s) => ({
              label: s.label,
              count: s.count,
              href: `/control/growth/waitlist?source=${encodeURIComponent(s.label === "direct" ? "" : s.label)}`,
            }))}
          />
        </Panel>
        <Panel title="Lifecycle" caption="status funnel (conversion derived from accounts)">
          <BarList
            items={[
              { label: "Waiting", count: overview.waiting },
              { label: "Invited", count: overview.invited, dim: true },
              { label: "Contacted", count: overview.contacted, dim: true },
              { label: "Converted", count: overview.converted },
              { label: "Removed", count: overview.removed, dim: true },
            ]}
          />
        </Panel>
        <Panel
          title="Top referrers"
          caption="who is actually bringing people in"
          action={
            <Link className="cp-btn" href="/control/growth/referrals">
              Referrals
            </Link>
          }
        >
          {topReferrers.length === 0 ? (
            <Empty title="No referrals yet" />
          ) : (
            <BarList
              items={topReferrers.map((r) => ({
                label: r.email ?? r.code,
                count: r.invites,
                href: `/control/growth/waitlist?q=${encodeURIComponent(r.email ?? r.code)}`,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel
        title={`Waitlist database`}
        caption={`${fmtInt(table.total)} matching · search, filter, then open a person for actions`}
        flush
      >
        <form className="cp-filters" method="get" style={{ padding: "12px 16px 0" }}>
          <input
            className="cp-input"
            type="search"
            name="q"
            placeholder="Search email, name, or code…"
            defaultValue={searchParams.q ?? ""}
            style={{ minWidth: 220 }}
          />
          <select
            className="cp-select"
            name="source"
            defaultValue={searchParams.source ?? ""}
            aria-label="Source"
          >
            <option value="">All sources</option>
            {sources
              .filter((s) => s.label !== "direct")
              .map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
            <option value="__direct__">direct</option>
          </select>
          <select
            className="cp-select"
            name="status"
            defaultValue={searchParams.status ?? ""}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="waiting">Waiting</option>
            <option value="invited">Invited</option>
            <option value="contacted">Contacted</option>
            <option value="converted">Converted</option>
            <option value="removed">Removed</option>
          </select>
          <select
            className="cp-select"
            name="referred"
            defaultValue={searchParams.referred ?? ""}
            aria-label="Referral"
          >
            <option value="">Referred + organic</option>
            <option value="referred">Referred only</option>
            <option value="organic">Organic only</option>
          </select>
          <select
            className="cp-select"
            name="sort"
            defaultValue={searchParams.sort ?? "newest"}
            aria-label="Sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Position order (oldest)</option>
          </select>
          {searchParams.range ? (
            <input type="hidden" name="range" value={searchParams.range} />
          ) : null}
          <button className="cp-btn primary" type="submit">
            Apply
          </button>
          {(searchParams.q ||
            searchParams.source ||
            searchParams.status ||
            searchParams.referred) && (
            <Link className="cp-btn" href="/control/growth/waitlist">
              Clear
            </Link>
          )}
        </form>

        {table.rows.length === 0 ? (
          <Empty title="No one matches">
            Adjust the filters, or the waitlist may be empty. Every number on this page is a live
            query.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Source</th>
                  <th>Country</th>
                  <th>Referral</th>
                  <th>Status</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => {
                  const position =
                    searchParams.sort === "oldest" ? (table.page - 1) * 50 + i + 1 : null;
                  return (
                    <tr key={r.id}>
                      <td className="mono" style={{ color: "var(--cp-faint)" }}>
                        {position ?? "—"}
                      </td>
                      <td>
                        <Link href={`/control/growth/waitlist/${r.id}`}>
                          {r.firstName ?? <span style={{ color: "var(--cp-muted)" }}>Unnamed</span>}
                        </Link>
                      </td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        <Link href={`/control/growth/waitlist/${r.id}`}>{r.email}</Link>
                      </td>
                      <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                        {fmtDate(new Date(r.createdAt))}
                      </td>
                      <td style={{ color: "var(--cp-muted)" }}>{r.source ?? "direct"}</td>
                      <td style={{ color: "var(--cp-muted)" }}>{r.country ?? "—"}</td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {r.referredBy ? (
                          <Badge tone="accent">
                            <span className="mono">{r.referredBy}</span>
                          </Badge>
                        ) : (
                          <span style={{ color: "var(--cp-faint)" }}>organic</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[r.status] === "ok" ? "ok" : undefined}>
                          <Dot tone={STATUS_TONE[r.status] ?? "idle"} /> {r.status}
                        </Badge>
                      </td>
                      <td>
                        {(r.tags ?? []).slice(0, 3).map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={table.page}
          pages={table.pages}
          total={table.total}
          basePath="/control/growth/waitlist"
          query={filters}
        />
      </Panel>

      <p className="cp-caption">
        Conversion counts waitlist emails that now hold a Calder account — derived live, never
        stored. "Invite" and note-taking live on each person&rsquo;s page.
      </p>
    </>
  );
}
