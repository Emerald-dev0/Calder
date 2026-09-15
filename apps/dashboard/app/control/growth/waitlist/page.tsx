import Link from "next/link";
import dynamicImport from "next/dynamic";
import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { WaitlistTable, type WaitlistTableRow } from "./waitlist-table";
import {
  waitlistDailyCounts,
  waitlistOverview,
  waitlistRows,
  waitlistSources,
} from "@/lib/control/queries";
import { cumulative } from "@/lib/control/format";
import { denseDailyFromWindow, parseRange, pctChange } from "@/lib/control/range";
import { Empty, PageHeader, Panel, SectionLabel, Stat } from "@/control/_components/ui";
import { FounderTopbar } from "@/control/_components/founder-topbar";

const CumulativeChart = dynamicImport(
  () => import("@/components/charts").then((m) => m.CumulativeChart),
  { ssr: false, loading: () => <div style={{ height: 260 }} /> }
);
const DailyBars = dynamicImport(() => import("@/components/charts").then((m) => m.DailyBars), {
  ssr: false,
});

export const dynamic = "force-dynamic";

interface SearchParams {
  range?: string;
  from?: string;
  to?: string;
  q?: string;
  source?: string;
  status?: string;
  referred?: string;
  sort?: string;
  page?: string;
  perPage?: string;
  bulk?: string;
}

export default async function WaitlistPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("growth");
  const window = parseRange(searchParams.range, searchParams.from, searchParams.to);
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const perPage = [25, 50, 100].includes(Number(searchParams.perPage))
    ? Number(searchParams.perPage)
    : 50;

  const [overview, daily, sources, table] = await Promise.all([
    waitlistOverview(),
    waitlistDailyCounts(window.days),
    waitlistSources(),
    waitlistRows({
      q: searchParams.q,
      source: searchParams.source,
      status: searchParams.status,
      referred: searchParams.referred,
      sort: searchParams.sort === "oldest" ? "oldest" : "newest",
      page,
      perPage,
    }),
  ]);

  const now = new Date();
  const wlDense = denseDailyFromWindow(window, daily, now);
  const cumulativeSeries = cumulative(wlDense);
  const delta = pctChange(overview.new7d, overview.prev7d);

  const filters = {
    q: searchParams.q,
    source: searchParams.source,
    status: searchParams.status,
    referred: searchParams.referred,
    sort: searchParams.sort,
    range: searchParams.range,
    from: searchParams.from,
    to: searchParams.to,
    perPage: perPage !== 50 ? String(perPage) : undefined,
  };
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) exportParams.set(k, v);

  return (
    <>
      <FounderTopbar
        title="Waitlist"
        context="Everyone who has raised their hand for Calder"
        rangeKey={window.key}
        customFrom={searchParams.from}
        customTo={searchParams.to}
      />
      <main className="cp-content">
        <PageHeader
          eyebrow="Growth / Waitlist"
          title="Waitlist"
          subtitle="The source of truth for early Calder. Position and conversion are computed live — never stored."
          right={
            <>
              <Link className="cp-btn" href={`/control/growth/waitlist/export?${exportParams.toString()}`}>
                Export CSV
              </Link>
            </>
          }
        />

        <SectionLabel right={<span className="cp-caption" style={{ margin: 0 }}>{window.compareLabel}</span>}>
          Summary
        </SectionLabel>
        <div className="cp-stats">
          <Stat label="Total people" value={fmtInt(overview.total)} hint="all-time signups" />
          <Stat
            label="New this week"
            value={fmtInt(overview.new7d)}
            delta={delta}
            basis="vs previous 7 days"
            hint={`${fmtInt(overview.newToday)} today`}
          />
          <Stat label="Converted" value={fmtInt(overview.converted)} hint="hold Calder accounts" />
          <Stat
            label="Conversion rate"
            value={fmtPct(overview.total ? (overview.converted / overview.total) * 100 : 0)}
            hint="waitlist → account"
          />
          <Stat
            label="Waiting"
            value={fmtInt(overview.waiting)}
            hint={`${fmtInt(overview.invited)} invited · ${fmtInt(overview.contacted)} contacted`}
          />
        </div>

        <SectionLabel>Waitlist growth</SectionLabel>
        <Panel title="Cumulative waitlist" caption={`Cumulative size · ${window.compareLabel.replace("vs ", "")}`}>
          <CumulativeChart
            data={cumulativeSeries.map((p) => ({ day: p.day, total: p.count }))}
            height={260}
          />
        </Panel>
        <div style={{ height: 14 }} />
        <Panel title="New signups per day" caption="Daily volume in range">
          <DailyBars data={wlDense.map((p) => ({ day: p.day, count: p.count }))} valueKey="count" label="Signups" height={200} />
        </Panel>

        <SectionLabel
          right={
            <>
              <select
                className="cp-select"
                name="perPage"
                form="waitlist-filters"
                defaultValue={String(perPage)}
                aria-label="Rows per page"
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
            </>
          }
        >
          Waitlist database
        </SectionLabel>
        <Panel flush>
          <form className="cp-filters" id="waitlist-filters" method="get" style={{ padding: "12px 16px 0" }}>
            <input
              className="cp-input"
              type="search"
              name="q"
              placeholder="Search name, email, or referral code…"
              defaultValue={searchParams.q ?? ""}
              style={{ minWidth: 220 }}
              aria-label="Search the waitlist"
            />
            <select className="cp-select" name="source" defaultValue={searchParams.source ?? ""} aria-label="Source">
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
            <select className="cp-select" name="status" defaultValue={searchParams.status ?? ""} aria-label="Status">
              <option value="">All statuses</option>
              <option value="waiting">Waiting</option>
              <option value="invited">Invited</option>
              <option value="contacted">Contacted</option>
              <option value="converted">Converted</option>
              <option value="removed">Removed</option>
            </select>
            <select className="cp-select" name="referred" defaultValue={searchParams.referred ?? ""} aria-label="Referral">
              <option value="">Referred + organic</option>
              <option value="referred">Referred only</option>
              <option value="organic">Organic only</option>
            </select>
            <select className="cp-select" name="sort" defaultValue={searchParams.sort ?? "newest"} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            {searchParams.range ? <input type="hidden" name="range" value={searchParams.range} /> : null}
            {searchParams.from ? <input type="hidden" name="from" value={searchParams.from} /> : null}
            {searchParams.to ? <input type="hidden" name="to" value={searchParams.to} /> : null}
            <button className="cp-btn primary" type="submit">
              Apply
            </button>
            {searchParams.q || searchParams.source || searchParams.status || searchParams.referred ? (
              <Link className="cp-btn" href="/control/growth/waitlist">
                Clear
              </Link>
            ) : null}
          </form>

          {overview.total === 0 && !searchParams.q && !searchParams.status && !searchParams.source ? (
            <Empty title="Your waitlist is empty">
              Once someone joins Calder, they&apos;ll appear here.
            </Empty>
          ) : (
            <WaitlistTable
              rows={table.rows.map(
                (r): WaitlistTableRow => ({
                  id: r.id,
                  email: r.email,
                  firstName: r.firstName,
                  createdAt: new Date(r.createdAt).toISOString(),
                  source: r.source,
                  country: r.country,
                  referredBy: r.referredBy,
                  status: r.status,
                  tags: r.tags ?? [],
                })
              )}
              total={table.total}
              page={table.page}
              pages={table.pages}
              perPage={perPage}
              query={{
                q: searchParams.q,
                source: searchParams.source,
                status: searchParams.status,
                referred: searchParams.referred,
                sort: searchParams.sort,
                range: searchParams.range,
                from: searchParams.from,
                to: searchParams.to,
                perPage: perPage !== 50 ? String(perPage) : undefined,
              }}
              basePath="/control/growth/waitlist"
            />
          )}
        </Panel>

        <p className="cp-caption">
          Statuses are the real lifecycle: waiting · invited · contacted · converted (has an account) ·
          removed. "Confirmed" is not a stored state — conversion is derived live.
        </p>
      </main>
    </>
  );
}


