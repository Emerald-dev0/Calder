import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { eventRows } from "@/lib/control/queries";
import { Badge, Dot, Empty, PageHeader, Panel, Pager } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const EVENT_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "idle"> = {
  delivered: "ok",
  sent: "ok",
  opened: "ok",
  clicked: "ok",
  queued: "info",
  created: "idle",
  bounced: "bad",
  failed: "bad",
  complained: "bad",
  suppressed: "warn",
};

export default async function LogsPage({
  searchParams,
}: {
  searchParams: { type?: string; q?: string; page?: string };
}) {
  await requireSection("observability");
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const data = await eventRows({ type: searchParams.type, q: searchParams.q, page });

  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Logs"
        subtitle="The full email event lifecycle, correlated by email, project, and request. Every state change is a row — nothing fails silently."
      />

      <Panel title="Event stream" caption={`${fmtInt(data.total)} events · newest first`} flush>
        <form className="cp-filters" method="get" style={{ padding: "12px 16px 0" }}>
          <input
            className="cp-input"
            type="search"
            name="q"
            placeholder="Filter by recipient…"
            defaultValue={searchParams.q ?? ""}
            style={{ minWidth: 220 }}
          />
          <select className="cp-select" name="type" defaultValue={searchParams.type ?? ""} aria-label="Event type">
            <option value="">All types</option>
            {data.byType.map((t) => (
              <option key={t.type} value={t.type}>
                {t.type} ({fmtInt(t.count)})
              </option>
            ))}
          </select>
          <button className="cp-btn primary" type="submit">
            Apply
          </button>
          {(searchParams.type || searchParams.q) && (
            <Link className="cp-btn" href="/control/observability">
              Clear
            </Link>
          )}
        </form>

        {data.rows.length === 0 ? (
          <Empty title="No events match" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Project</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <Dot tone={EVENT_TONE[e.type] ?? "idle"} />
                        <span className="mono" style={{ fontSize: 12.5 }}>
                          {e.type}
                        </span>
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {e.to}
                    </td>
                    <td className="wrap" style={{ whiteSpace: "normal", maxWidth: 300 }}>
                      {e.subject}
                    </td>
                    <td style={{ color: "var(--cp-muted)" }}>{e.projectName}</td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(e.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          basePath="/control/observability"
          query={{ type: searchParams.type, q: searchParams.q }}
        />
      </Panel>

      <p className="cp-caption">
        The connected path: API error spike → queue growth → worker latency → provider latency → delivery degradation.
        Jump: <Link href="/control/infrastructure/queues">Queues</Link> ·{" "}
        <Link href="/control/platform/deliverability">Deliverability</Link> ·{" "}
        <Badge tone="accent">request_id tracing in API logs</Badge>
      </p>
    </>
  );
}
