import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { WebhookCreator, ToggleButton, RotateButton, ReplayButton } from "./manager";
import { listWebhooks, listWebhookDeliveries } from "./actions";
import { Webhook, ShieldCheck } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  CodeBlock,
} from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<Webhook size={18} />}
          title="Webhooks"
          description="No project found. Complete onboarding first."
        />
        <EmptyState
          title="No project found"
          description="Create a project to register webhook endpoints."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }
  const hooks = await listWebhooks(scope.project.id);
  const deliveryMap = new Map(
    await Promise.all(
      hooks.map(
        async (w) => [w.id, await listWebhookDeliveries(scope.project.id, w.id)] as const,
      ),
    ),
  );

  return (
    <div>
      <DsPageHeader
        icon={<Webhook size={18} />}
        title="Webhooks"
        badge={
          <StatusPill
            status="active"
            label={`${hooks.length} ${hooks.length === 1 ? "endpoint" : "endpoints"}`}
          />
        }
        description="HMAC-SHA256 signed, automatically retried with exponential backoff (up to 8×), and one-click replayable. Signing secrets are encrypted at rest."
      />

      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/webhooks"
      />

      <WebhookCreator projectId={scope.project.id} />

      {hooks.length === 0 ? (
        <EmptyState
          icon={<Webhook size={22} />}
          title="No webhook endpoints configured yet"
          description="Add your HTTPS callback URL above. Deliveries, bounces, complaints, and opens will arrive as signed JSON POST events."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {hooks.map((w) => {
            const deliveries = deliveryMap.get(w.id) ?? [];
            return (
              <div key={w.id} className="ds-card">
                <div className="ds-card-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <b className="mono" style={{ fontSize: 13.5 }}>
                        {w.url}
                      </b>
                      <StatusPill status={w.enabled ? "active" : "disabled"} />
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 4 }}
                    >
                      {w.events.join(" · ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <RotateButton projectId={scope.project.id} webhookId={w.id} />
                    <ToggleButton
                      projectId={scope.project.id}
                      webhookId={w.id}
                      enabled={w.enabled}
                    />
                  </div>
                </div>

                <div className="ds-card-body">
                  <details open={deliveries.length > 0}>
                    <summary
                      style={{
                        cursor: "pointer",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--color-ink-secondary)",
                      }}
                    >
                      Recent Deliveries ({deliveries.length}) — signed POSTs, retried up to 8×, 10s timeout
                    </summary>
                    {deliveries.length === 0 ? (
                      <p
                        style={{
                          fontSize: 12.5,
                          color: "var(--color-muted)",
                          margin: "10px 0 0",
                        }}
                      >
                        Nothing delivered yet. Send an email matching the subscribed events and its delivery log will appear here.
                      </p>
                    ) : (
                      <div className="ds-table-scroll" style={{ marginTop: 10 }}>
                        <table className="ds-table is-compact">
                          <thead>
                            <tr>
                              <th>Event</th>
                              <th>Status</th>
                              <th>Attempts</th>
                              <th>Latency</th>
                              <th>HTTP</th>
                              <th>Last Error</th>
                              <th style={{ textAlign: "right" }}>Replay</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deliveries.map((d) => (
                              <tr key={d.id}>
                                <td className="mono">{d.event}</td>
                                <td>
                                  <StatusPill status={d.status} />
                                  {d.status === "pending" && d.nextAttemptAt && (
                                    <span
                                      className="mono"
                                      style={{ color: "var(--color-muted)", fontSize: 11, marginLeft: 6 }}
                                    >
                                      retry {new Date(d.nextAttemptAt).toLocaleTimeString("en-GB")}
                                    </span>
                                  )}
                                </td>
                                <td className="mono tabular-nums">{d.attemptCount}</td>
                                <td className="mono tabular-nums">
                                  {d.latencyMs != null ? `${d.latencyMs}ms` : "—"}
                                </td>
                                <td className="mono tabular-nums">{d.responseStatus ?? "—"}</td>
                                <td
                                  style={{
                                    color: "var(--color-danger)",
                                    maxWidth: 260,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={d.lastError ?? ""}
                                >
                                  {d.lastError ?? "—"}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <ReplayButton
                                    projectId={scope.project.id}
                                    webhookId={w.id}
                                    deliveryId={d.id}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ds-card" style={{ marginTop: 20 }}>
        <div className="ds-card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={16} style={{ color: "var(--color-success)" }} />
            <div>
              <h2 className="ds-card-title">Verify Webhook Signatures (HMAC-SHA256)</h2>
              <p className="ds-card-subtitle">
                Every delivery includes a <code className="mono">webhook-signature</code> header (<code className="mono">t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>). Reject payloads older than 5 minutes.
              </p>
            </div>
          </div>
        </div>
        <div className="ds-card-body">
          <CodeBlock
            title="verify-webhook.ts"
            code={`const [t, v1] = req.headers["webhook-signature"]
  .split(",").map((kv) => kv.slice(2));
const expected = crypto.createHmac("sha256", SECRET)
  .update(t + "." + rawBody, "utf8").digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex")))
  return res.status(401).end();`}
          />
        </div>
      </div>
    </div>
  );
}
