import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { requireSection } from "@/lib/control/guard";
import { incidentDetail } from "@/lib/control/incidents";
import {
  canManageIncidents,
  canTransitionIncident,
  INCIDENT_STATUSES,
} from "@/lib/control/incident-policy";
import { fmtDateTime } from "@/lib/control/format";
import { KV, PageHeader, Panel } from "@/control/_components/ui";
import { updateIncident } from "../actions";
export const dynamic = "force-dynamic";
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSection("observability");
  const { id } = await params;
  const data = await incidentDetail(id);
  if (!data) notFound();
  const { incident, updates } = data;
  const updateId = `inc_${randomUUID()}`;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/control/observability/incidents">Observability / Incidents</Link>}
        title={incident.title}
        subtitle="Private incident record · no public publication or notification"
      />
      <div className="cp-grid cp-grid-2">
        <Panel title="Investigation" caption={incident.id}>
          <p style={{ whiteSpace: "pre-wrap" }}>{incident.summary}</p>
          <KV k="Severity" v={incident.severity.toUpperCase()} />
          <KV k="Status" v={incident.status} />
          <KV k="Opened · UTC" v={fmtDateTime(incident.createdAt)} />
          <KV k="Recorded by" v={incident.createdBy ?? "Deleted operator"} />
          <KV
            k="Resolved · UTC"
            v={incident.resolvedAt ? fmtDateTime(incident.resolvedAt) : "Not resolved"}
          />
        </Panel>
        {canManageIncidents(ctx.role) && incident.status !== "resolved" ? (
          <Panel
            title="Record an update"
            caption="Audit and incident state commit together; stale edits are rejected"
          >
            <form
              className="cp-incident-form"
              action={async (formData: FormData) => {
                "use server";
                await updateIncident({
                  id,
                  updateId,
                  revision: incident.revision,
                  status: String(formData.get("status") ?? ""),
                  message: String(formData.get("message") ?? ""),
                });
                redirect(`/control/observability/incidents/${id}`);
              }}
            >
              <label>
                Status
                <select className="cp-select" name="status" defaultValue={incident.status}>
                  {INCIDENT_STATUSES.filter((status) =>
                    canTransitionIncident(incident.status, status)
                  ).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Investigation / mitigation note
                <textarea
                  className="cp-input"
                  rows={5}
                  name="message"
                  required
                  minLength={6}
                  maxLength={4000}
                />
              </label>
              <button className="cp-btn primary" type="submit">
                Record update
              </button>
            </form>
          </Panel>
        ) : (
          <Panel title="Record state">
            <p>
              {incident.status === "resolved"
                ? "Resolved records are closed. Open a new incident for recurrence."
                : "Your role has read-only access to this incident."}
            </p>
          </Panel>
        )}
      </div>
      <Panel
        title="Investigation timeline"
        caption="Latest 100 updates, newest first · operator IDs retained"
      >
        {updates.length ? (
          updates.map((update) => (
            <article className="cp-incident-update" key={update.id}>
              <b>
                {update.fromStatus} → {update.toStatus}
              </b>
              <p style={{ whiteSpace: "pre-wrap" }}>{update.message}</p>
              <p className="cp-panel-caption">
                {fmtDateTime(update.createdAt)} UTC · {update.actorUserId ?? "Deleted operator"}
              </p>
            </article>
          ))
        ) : (
          <p>No follow-up updates recorded. The initial investigation is above.</p>
        )}
      </Panel>
    </>
  );
}
