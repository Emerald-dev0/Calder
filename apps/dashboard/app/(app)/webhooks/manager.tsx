"use client";

import * as React from "react";
import { Plus, RotateCw, Power, RefreshCw } from "lucide-react";
import { createWebhook, setWebhookEnabled, replayDelivery, rotateWebhookSecret } from "./actions";
import { WEBHOOK_EVENTS } from "./events";
import { CopyField, DsBanner } from "../../../components/design-system";

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
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Register Webhook Endpoint</h2>
          <p className="ds-card-subtitle">
            Subscribe an HTTPS URL to receive real-time HMAC-SHA256 signed event payloads.
          </p>
        </div>
      </div>

      <div className="ds-card-body">
        <div style={{ marginBottom: 14 }}>
          <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
            Endpoint HTTPS URL
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://acme.com/hooks/calder"
            className="ds-input mono"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="ds-label" style={{ display: "block", marginBottom: 8 }}>
            Subscribed Event Types
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {WEBHOOK_EVENTS.map((e) => {
              const on = events.includes(e);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggle(e)}
                  className="mono"
                  style={{
                    border: `1px solid ${on ? "var(--color-ink)" : "var(--color-border-strong)"}`,
                    boxShadow: on ? "inset 0 0 0 1px var(--color-ink)" : "none",
                    background: on ? "var(--color-surface-elevated)" : "var(--color-surface)",
                    color: "var(--color-ink)",
                    borderRadius: 999,
                    padding: "5px 12px",
                    fontSize: 12,
                    fontWeight: on ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {on ? "✓ " : ""}
                  {e}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || !url.trim()}
          className="ds-btn ds-btn-primary"
        >
          <Plus size={14} />
          <span>{busy ? "Adding…" : "Add endpoint"}</span>
        </button>

        {secret && (
          <div style={{ marginTop: 14 }}>
            <DsBanner
              tone="warning"
              title="Signing secret generated — copy it now (shown only once)"
              description={
                <div style={{ marginTop: 8 }}>
                  <CopyField label="Secret" value={secret} />
                </div>
              }
            />
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12 }}>
            <DsBanner tone="danger" title="Could not create endpoint" description={error} />
          </div>
        )}
      </div>
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
      type="button"
      onClick={async () => {
        await setWebhookEnabled(projectId, webhookId, !on);
        setOn(!on);
      }}
      className="ds-btn ds-btn-secondary ds-btn-sm"
    >
      <Power size={12} />
      <span>{on ? "Disable" : "Enable"}</span>
    </button>
  );
}

export function RotateButton({ projectId, webhookId }: { projectId: string; webhookId: string }) {
  const [secret, setSecret] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await rotateWebhookSecret(projectId, webhookId);
            setSecret(r.secret);
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="ds-btn ds-btn-secondary ds-btn-sm"
      >
        <RotateCw size={12} />
        <span>Rotate secret</span>
      </button>
      {secret && <CopyField label="New secret" value={secret} compact />}
    </span>
  );
}

export function ReplayButton({
  projectId,
  webhookId,
  deliveryId,
}: {
  projectId: string;
  webhookId: string;
  deliveryId: string;
}) {
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "error">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState("busy");
        try {
          await replayDelivery(projectId, webhookId, deliveryId);
          setState("done");
        } catch {
          setState("error");
        }
      }}
      disabled={state === "busy"}
      className="ds-btn ds-btn-ghost ds-btn-sm"
      style={{
        height: 26,
        fontSize: 11.5,
        color:
          state === "error"
            ? "var(--color-danger)"
            : state === "done"
              ? "var(--color-success)"
              : undefined,
      }}
    >
      <RefreshCw size={11} />
      <span>
        {state === "busy"
          ? "…"
          : state === "done"
            ? "replayed"
            : state === "error"
              ? "failed"
              : "replay"}
      </span>
    </button>
  );
}
