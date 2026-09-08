"use client";

import * as React from "react";
import { createKey, revokeKey } from "./actions";

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

/** Create form. Secret displays once, then vanishes on reload. */
export function KeyCreator({ projectId }: { projectId: string }) {
  const [name, setName] = React.useState("");
  const [env, setEnv] = React.useState<"test" | "live">("test");
  const [secret, setSecret] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const k = await createKey(projectId, name || `${env} key`, env);
      setSecret(k.secret);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create key.");
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
      <p style={{ fontWeight: 600, margin: "0 0 12px" }}>New key</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="production-web"
          style={{
            height: 44,
            border: "1px solid #D4D4D4",
            borderRadius: 10,
            padding: "0 14px",
            fontSize: 14,
            flex: 1,
            minWidth: 180,
          }}
        />
        <select
          value={env}
          onChange={(e) => setEnv(e.target.value as "test" | "live")}
          style={{
            height: 44,
            border: "1px solid #D4D4D4",
            borderRadius: 10,
            padding: "0 14px",
            fontSize: 14,
          }}
        >
          <option value="test">test</option>
          <option value="live">live</option>
        </select>
        <button onClick={() => void create()} disabled={busy} style={btnPrimary}>
          Create
        </button>
      </div>
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
            Shown once — copy it now, then reload to see it listed by prefix.
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

/** Per-row revoke button for the server-rendered key list. */
export function RevokeButton({ projectId, keyId }: { projectId: string; keyId: string }) {
  const [done, setDone] = React.useState(false);
  if (done) return <span style={{ fontSize: 13, color: "#737373" }}>revoked</span>;
  return (
    <button
      onClick={async () => {
        if (!window.confirm("Revoke this key? Calls using it fail immediately.")) return;
        await revokeKey(projectId, keyId);
        setDone(true);
      }}
      style={{
        background: "none",
        border: "1px solid #E5E5E5",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 13,
        color: "#DC2626",
        cursor: "pointer",
      }}
    >
      Revoke
    </button>
  );
}
