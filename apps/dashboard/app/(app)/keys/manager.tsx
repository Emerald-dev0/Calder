"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { createKey, revokeKey } from "./actions";
import {
  CopyField,
  DsBanner,
  ConfirmDialog,
  StatusPill,
} from "../../../components/design-system";

/** Create form. Secret displays once, then vanishes on reload. */
export function KeyCreator({ projectId }: { projectId: string }) {
  const [name, setName] = React.useState("");
  const [env, setEnv] = React.useState<"test" | "live">("test");
  const [scope, setScope] = React.useState<"full" | "send" | "read">("full");
  const [secret, setSecret] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const k = await createKey(projectId, name || `${env} key`, env, scope);
      setSecret(k.secret);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Issue Scoped API Key</h2>
          <p className="ds-card-subtitle">
            Keys are hashed with Argon2id before storage. The raw secret is shown once upon creation.
          </p>
        </div>
      </div>
      <div className="ds-card-body">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key label (e.g. production-web)"
            className="ds-input"
            style={{ flex: 1, minWidth: 200 }}
          />
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value as "test" | "live")}
            className="ds-select"
            style={{ width: "auto", minWidth: 150 }}
          >
            <option value="test">test (sandbox)</option>
            <option value="live">live (production)</option>
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "full" | "send" | "read")}
            className="ds-select"
            style={{ width: "auto", minWidth: 150 }}
          >
            <option value="full">scope: full</option>
            <option value="send">scope: send-only</option>
            <option value="read">scope: read-only</option>
          </select>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="ds-btn ds-btn-primary"
          >
            <Plus size={14} />
            <span>{busy ? "Creating…" : "Create key"}</span>
          </button>
        </div>

        {secret && (
          <div style={{ marginTop: 14 }}>
            <DsBanner
              tone="warning"
              title="Copy your API key now — it will never be shown again"
              description={
                <div style={{ marginTop: 8 }}>
                  <CopyField label="API Key" value={secret} />
                </div>
              }
            />
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12 }}>
            <DsBanner tone="danger" title="Could not create key" description={error} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Per-row revoke button for the server-rendered key list. */
export function RevokeButton({ projectId, keyId }: { projectId: string; keyId: string }) {
  const [done, setDone] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (done) return <StatusPill status="revoked" />;
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="ds-btn ds-btn-danger ds-btn-sm"
      >
        <Trash2 size={12} />
        <span>Revoke</span>
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await revokeKey(projectId, keyId);
            setDone(true);
          } finally {
            setBusy(false);
            setConfirmOpen(false);
          }
        }}
        title="Revoke API Key Immediately?"
        description="Any service or worker authenticating with this key will immediately receive 401 Unauthorized responses. This action is permanent."
        confirmLabel="Revoke key"
      />
    </>
  );
}
