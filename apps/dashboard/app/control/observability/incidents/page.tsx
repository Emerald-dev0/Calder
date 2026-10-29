import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireSection } from "@/lib/control/guard";
import { incidentRows } from "@/lib/control/incidents";
import { canManageIncidents, INCIDENT_STATUSES } from "@/lib/control/incident-policy";
import { fmtDateTime } from "@/lib/control/format";
import { PageHeader, Panel, Pager, Empty, Badge } from "@/control/_components/ui";
import { createIncident } from "./actions";
export const dynamic = "force-dynamic";
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const ctx = await requireSection("observability");
  const query = await searchParams;
  const page = Math.max(1, Math.min(100000, parseInt(query.page ?? "1", 10) || 1));
  const data = await incidentRows(query.status, page);
  const id = `inc_${randomUUID()}`;
  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Incident log"
        subtitle="Private, manually maintained investigation records. No automatic paging, customer notification or public status publication is implied."
      />
      <Panel
        title="Investigations"
        caption={`${data.total} matching ${data.total === 1 ? "incident" : "incidents"}`}
        flush
      >
        <form method="get" className="cp-filters">
          <label htmlFor="incident-status">Status</label>
          <select
            id="incident-status"
            name="status"
            className="cp-select"
            defaultValue={query.status ?? ""}
          >
            <option value="">All statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="cp-btn" type="submit">
            Filter
          </button>
        </form>
        {data.rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Updated · UTC</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/control/observability/incidents/${row.id}`}>{row.title}</Link>
                    </td>
                    <td>{row.severity.toUpperCase()}</td>
                    <td>
                      <Badge tone={row.status === "resolved" ? "ok" : "warn"}>{row.status}</Badge>
                    </td>
                    <td>{fmtDateTime(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching incidents">
            No manual records match this filter. This does not certify system health.
          </Empty>
        )}
        <Pager
          {...data}
          query={{ status: query.status }}
          basePath="/control/observability/incidents"
        />
      </Panel>
      {canManageIncidents(ctx.role) ? (
        <Panel
          title="Open an incident"
          caption="Internal only · do not include credentials, message bodies or customer secrets"
        >
          <form
            className="cp-incident-form"
            action={async (formData: FormData) => {
              "use server";
              const result = await createIncident({
                id,
                title: String(formData.get("title") ?? ""),
                summary: String(formData.get("summary") ?? ""),
                severity: String(formData.get("severity") ?? ""),
              });
              redirect(`/control/observability/incidents/${result.id}`);
            }}
          >
            <label>
              Title
              <input name="title" className="cp-input" required minLength={6} maxLength={200} />
            </label>
            <label>
              Severity
              <select className="cp-select" name="severity" defaultValue="sev3">
                <option value="sev1">SEV1 · Critical outage</option>
                <option value="sev2">SEV2 · Major degradation</option>
                <option value="sev3">SEV3 · Limited impact</option>
                <option value="sev4">SEV4 · Investigation</option>
              </select>
            </label>
            <label>
              Initial investigation
              <textarea
                className="cp-input"
                name="summary"
                required
                minLength={6}
                maxLength={4000}
                rows={4}
              />
            </label>
            <button className="cp-btn primary" type="submit">
              Create private incident
            </button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
