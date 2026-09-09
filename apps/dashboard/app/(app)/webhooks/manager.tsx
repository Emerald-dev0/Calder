"use client";

import * as React from "react";
import { createWebhook, setWebhookEnabled } from "./actions";
import { WEBHOOK_EVENTS } from "./events";

const btnPrimary: React.CSSProperties = {
 background: "#0B0C0E",
 color: "#fff",
 border: "none",
 borderRadius: 10,
 height: 44,
 padding: "0 22px",
 fontSize: 14,
 fontWeight: 600,
 cursor: "pointer",
};

export function WebhookCreator({ projectId }: { projectId: string }) {
 const [url, setUrl] = React.useState("");
 const [events, setEvents] = React.useState<string[]>(["email.delivered", "email.bounced"]);
 const [secret, setSecret] = React.useState<string | null>(null);
 const [busy, setBusy] = React.useState(false);
 const [error, setError] = React.useState<string | null>(null);

 function toggle(e: string) {
 setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);
 }

 async function create() {
 setBusy(true);
 setError(null);
 try {
 const w = await createWebhook(projectId, url, events);
 setSecret(w.secret);
 setUrl("");
 } catch (e) {
 setError(e instanceof Error ? e.message : "Could not create endpoint.");
 } finally {
 setBusy(false);
 }
 }

 return (
 <div
 style={{
 background: "#fff",
 border: "1px solid #E5E5E5",
 borderRadius: 12,
 padding: 20,
 marginBottom: 20,
 }}
 >
 <p style={{ fontWeight: 600, margin: "0 0 12px" }}>New endpoint</p>
 <input
 value={url}
 onChange={(e) => setUrl(e.target.value)}
 placeholder="https://acme.com/hooks/calder"
 style={{
 width: "100%",
 height: 44,
 border: "1px solid #D4D4D4",
 borderRadius: 10,
 padding: "0 14px",
 fontSize: 14,
 boxSizing: "border-box",
 marginBottom: 12,
 }}
 />
 <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
 {WEBHOOK_EVENTS.map((e) => {
 const on = events.includes(e);
 return (
 <button
 key={e}
 type="button"
 onClick={() => toggle(e)}
 className="mono"
 style={{
 border: on ? "2px solid #0B0C0E" : "1px solid #D4D4D4",
 background: on ? "#F5F4EF" : "#fff",
 borderRadius: 999,
 padding: "6px 12px",
 fontSize: 12,
 cursor: "pointer",
 }}
 >
 {e}
 </button>
 );
 })}
 </div>
 <button onClick={() => void create()} disabled={busy} style={btnPrimary}>
 Add endpoint
 </button>
 {secret && (
 <div
 style={{
 marginTop: 14,
 background: "#0B0C0E",
 color: "#fff",
 borderRadius: 10,
 padding: "14px 16px",
 fontFamily: "monospace",
 fontSize: 13,
 wordBreak: "break-all",
 }}
 >
 {secret}
 <span
 style={{
 display: "block",
 fontSize: 12,
 color: "#B5B5B5",
 marginTop: 6,
 fontFamily: "sans-serif",
 }}
 >
 Signing secret, shown once. Verify HMAC-SHA256 with it.
 </span>
 </div>
 )}
 {error && (
 <p role="alert" style={{ color: "#DC2626", fontSize: 14 }}>
 {error}
 </p>
 )}
 </div>
 );
}

export function ToggleButton({
 projectId,
 webhookId,
 enabled,
}: {
 projectId: string;
 webhookId: string;
 enabled: boolean;
}) {
 const [on, setOn] = React.useState(enabled);
 return (
 <button
 onClick={async () => {
 await setWebhookEnabled(projectId, webhookId, !on);
 setOn(!on);
 }}
 style={{
 background: "none",
 border: "1px solid #E5E5E5",
 borderRadius: 8,
 padding: "6px 12px",
 fontSize: 13,
 cursor: "pointer",
 }}
 >
 {on ? "Disable" : "Enable"}
 </button>
 );
}
