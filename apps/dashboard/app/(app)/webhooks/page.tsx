import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { WebhookCreator, ToggleButton, RotateButton, ReplayButton } from "./manager";
import { listWebhooks, listWebhookDeliveries } from "./actions";

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
 <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Webhooks</h1>
 <p style={{ color: "#737373" }}>No project found. Complete onboarding first.</p>
 </div>
 );
 }
 const hooks = await listWebhooks(scope.project.id);
  const deliveryMap = new Map(
    await Promise.all(
      hooks.map(async (w) => [w.id, await listWebhookDeliveries(scope.project.id, w.id)] as const)
    )
  );

 return (
 <div>
 <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Webhooks</h1>
 <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
 Signed, retried, replayable. Secrets are encrypted at rest.
 </p>
 <ProjectPicker
 projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
 currentId={scope.project.id}
 basePath="/webhooks"
 />
 <WebhookCreator projectId={scope.project.id} />
 <div
 style={{
 background: "#fff",
 border: "1px solid #E5E5E5",
 borderRadius: 12,
 overflow: "hidden",
 }}
 >
 {hooks.length === 0 && (
 <p style={{ padding: 20, color: "#737373", fontSize: 14, margin: 0 }}>
 No endpoints yet. Add your URL above, deliveries, bounces, and opens will start
 arriving as signed events.
 </p>
 )}
 {hooks.map((w, i) => {
  const deliveries = deliveryMap.get(w.id) ?? [];
  return (
    <div
      key={w.id}
      style={{
        padding: "12px 16px",
        borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
        fontSize: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <b className="mono" style={{ fontSize: 13 }}>
            {w.url}
          </b>
          <div style={{ fontSize: 12, color: "#737373", marginTop: 2 }}>
            {w.events.join(" · ")}{" "}
            {!w.enabled && <b style={{ color: "#B45309" }}>· disabled</b>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RotateButton projectId={scope.project.id} webhookId={w.id} />
          <ToggleButton projectId={scope.project.id} webhookId={w.id} enabled={w.enabled} />
        </div>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: "#737373" }}>
          Deliveries ({deliveries.length}) — signed POSTs, retried up to 8×, 10s timeout
        </summary>
        {deliveries.length === 0 ? (
          <p style={{ fontSize: 13, color: "#737373", margin: "10px 0 4px" }}>
            Nothing delivered yet. Send an email matching the subscribed events and it will show up
            here with its result.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 10 }}>
            <thead>
              <tr style={{ color: "#737373", textAlign: "left" }}>
                <th style={{ padding: "4px 8px 4px 0", fontWeight: 600 }}>Event</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Attempts</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Latency</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>HTTP</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Last error</th>
                <th style={{ padding: "4px 0", fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid #F5F5F5" }}>
                  <td className="mono" style={{ padding: "6px 8px 6px 0" }}>{d.event}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <b
                      style={{
                        color:
                          d.status === "delivered"
                            ? "#16A34A"
                            : d.status === "failed"
                              ? "#DC2626"
                              : "#B45309",
                      }}
                    >
                      {d.status}
                    </b>
                    {d.status === "pending" && d.nextAttemptAt && (
                      <span style={{ color: "#737373", fontSize: 11 }}>
                        {" "}
                        · retry {new Date(d.nextAttemptAt).toLocaleTimeString("en-GB")}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{d.attemptCount}</td>
                  <td style={{ padding: "6px 8px" }}>{d.latencyMs != null ? `${d.latencyMs}ms` : "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{d.responseStatus ?? "—"}</td>
                  <td style={{ padding: "6px 8px", color: "#B91C1C", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.lastError ?? ""}>
                    {d.lastError ?? ""}
                  </td>
                  <td style={{ padding: "6px 0" }}>
                    <ReplayButton projectId={scope.project.id} webhookId={w.id} deliveryId={d.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
 })}
 </div>

 <div
 style={{
 background: "#fff",
 border: "1px solid #E5E5E5",
 borderRadius: 12,
 padding: 20,
 marginTop: 20,
 }}
 >
 <p style={{ fontWeight: 600, margin: "0 0 8px" }}>Verify signatures</p>
 <p style={{ fontSize: 13, color: "#737373", margin: "0 0 10px" }}>
 Every delivery is POSTed as JSON with a <code>webhook-signature</code> header —{" "}
 <code>t=&lt;unix&gt;,v1=&lt;hmac&gt;</code> where the HMAC is SHA-256 over{" "}
 <code>t.body</code> using your endpoint's secret. Verify with
 timing-safe comparison and reject anything older than 5 minutes.
 </p>
 <pre
 className="mono"
 style={{
 background: "#0B0C0E",
 color: "#E8E9EA",
 borderRadius: 10,
 padding: 14,
 fontSize: 12,
 overflowX: "auto",
 lineHeight: 1.6,
 }}
 >{`const [t, v1] = req.headers["webhook-signature"]
  .split(",").map((kv) => kv.slice(2));
const expected = crypto.createHmac("sha256", SECRET)
  .update(t + "." + rawBody, "utf8").digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex")))
  return res.status(401).end();`}</pre>
 </div>
 </div>
 );
}
