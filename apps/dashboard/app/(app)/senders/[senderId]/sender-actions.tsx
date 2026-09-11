"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  setDefaultSender,
  updateSenderDisplayName,
  setSenderEnabled,
  deleteSender,
  testSend,
} from "../actions";

const btnSecondary = {
  background: "#fff",
  color: "#0B0C0E",
  border: "1px solid #D4D4D4",
  borderRadius: 8,
  padding: "0 14px",
  height: 38,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
} as const;

const btnDanger = {
  background: "#fff",
  color: "#DC2626",
  border: "1px solid #FCA5A5",
  borderRadius: 8,
  padding: "0 14px",
  height: 38,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
} as const;

export interface SenderActionTarget {
  id: string;
  projectId: string;
  displayName: string;
  email: string;
  status: string;
  isDefault: boolean;
  emailCount: number;
}

/** Identity, delivery, configuration, usage actions. Destructive ones confirm first. */
export function SenderActions({ sender }: { sender: SenderActionTarget }) {
  const router = useRouter();
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<{ text: string; ok: boolean; emailId?: string } | null>(
    null
  );
  const [name, setName] = useState(sender.displayName);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function run(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ text: okText, ok: true });
      router.refresh();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
    }
    setBusy(false);
  }

  const usable = sender.status === "verified" || sender.status === "connected";

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E5E5",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 640,
      }}
    >
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Test send</p>
        <p style={{ fontSize: 12, color: "#737373", margin: "0 0 8px" }}>
          Sends one real email through this sender. We report acceptance only, delivery lands on
          the record.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            type="email"
            placeholder="you@example.com"
            aria-label="Test recipient"
            disabled={!usable}
            style={{
              flex: 1,
              minWidth: 0,
              height: 38,
              border: "1px solid #D4D4D4",
              borderRadius: 8,
              padding: "0 12px",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            disabled={busy || !usable}
            onClick={async () => {
              setBusy(true);
              setTestMsg(null);
              try {
                const r = await testSend(sender.id, testTo);
                setTestMsg({ text: `Accepted. Message ${r.emailId}.`, ok: true, emailId: r.emailId });
                router.refresh();
              } catch (err) {
                setTestMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
              }
              setBusy(false);
            }}
            style={btnSecondary}
          >
            {busy ? "Sending…" : "Send test"}
          </button>
        </div>
        {!usable && (
          <p style={{ fontSize: 12, color: "#B45309", margin: "8px 0 0" }}>
            This sender isn&rsquo;t ready (status: {sender.status}). Test send unlocks after
            verification.
          </p>
        )}
        {testMsg && (
          <p style={{ fontSize: 12, margin: "8px 0 0", color: testMsg.ok ? "#16A34A" : "#DC2626" }}>
            {testMsg.text}{" "}
            {testMsg.emailId && (
              <a
                href={`/emails?project=${sender.projectId}`}
                style={{ color: "#0B0C0E" }}
              >
                View deliveries
              </a>
            )}
          </p>
        )}
      </div>

      <div>
        <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Display name</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Display name"
            style={{
              flex: 1,
              minWidth: 0,
              height: 38,
              border: "1px solid #D4D4D4",
              borderRadius: 8,
              padding: "0 12px",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => updateSenderDisplayName(sender.id, name), "Saved.")}
            style={btnSecondary}
          >
            Save
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!sender.isDefault && usable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => setDefaultSender(sender.id), "Default sender set.")}
            style={btnSecondary}
          >
            Set as default
          </button>
        )}
        {sender.status !== "disabled" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => setSenderEnabled(sender.id, false), "Sender disabled.")}
            style={btnSecondary}
          >
            Disable sender
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => setSenderEnabled(sender.id, true), "Sender re-enabled.")}
            style={btnSecondary}
          >
            Re-enable sender
          </button>
        )}
        {!confirmingDelete ? (
          <button type="button" onClick={() => setConfirmingDelete(true)} style={btnDanger}>
            Delete sender
          </button>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "#737373", alignSelf: "center" }}>
              {sender.emailCount > 0
                ? `Delete? ${sender.emailCount} past deliveries keep their records.`
                : "Delete this sender? This cannot be undone."}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteSender(sender.id);
                  router.push(`/senders?project=${sender.projectId}`);
                } catch (err) {
                  setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
                }
                setBusy(false);
                setConfirmingDelete(false);
              }}
              style={btnDanger}
            >
              Confirm delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} style={btnSecondary}>
              Keep
            </button>
          </>
        )}
      </div>
      {msg && <p style={{ fontSize: 12, margin: 0, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</p>}
    </div>
  );
}
