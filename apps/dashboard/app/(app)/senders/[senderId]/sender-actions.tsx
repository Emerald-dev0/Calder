"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Save, Trash2, CheckCircle2, Ban } from "lucide-react";
import {
  setDefaultSender,
  updateSenderDisplayName,
  setSenderEnabled,
  deleteSender,
  testSend,
} from "../actions";
import { DsBanner, ConfirmDialog } from "../../../../components/design-system";

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
    null,
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
    <div className="ds-grid-2">
      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Dispatch Verification Email</h2>
            <p className="ds-card-subtitle">
              Send one real email through this sender identity to verify inbox placement.
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              type="email"
              placeholder="you@example.com"
              aria-label="Test recipient"
              disabled={!usable}
              className="ds-input"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              disabled={busy || !usable}
              onClick={async () => {
                setBusy(true);
                setTestMsg(null);
                try {
                  const r = await testSend(sender.id, testTo);
                  setTestMsg({
                    text: `Accepted. Message ${r.emailId}.`,
                    ok: true,
                    emailId: r.emailId,
                  });
                  router.refresh();
                } catch (err) {
                  setTestMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
                }
                setBusy(false);
              }}
              className="ds-btn ds-btn-primary"
            >
              <Send size={13} />
              <span>{busy ? "Sending…" : "Send test"}</span>
            </button>
          </div>
          {!usable && (
            <div style={{ marginTop: 10 }}>
              <DsBanner
                tone="warning"
                title={`Sender status: ${sender.status}`}
                description="Test send unlocks automatically once domain verification completes."
              />
            </div>
          )}
          {testMsg && (
            <div style={{ marginTop: 10 }}>
              <DsBanner
                tone={testMsg.ok ? "success" : "danger"}
                title={testMsg.ok ? "Test email dispatched" : "Test send failed"}
                description={
                  <span>
                    {testMsg.text}{" "}
                    {testMsg.emailId && (
                      <a
                        href={`/emails?project=${sender.projectId}`}
                        style={{ color: "var(--color-ink)", fontWeight: 600 }}
                      >
                        View in Message Explorer →
                      </a>
                    )}
                  </span>
                }
              />
            </div>
          )}
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Identity Configuration</h2>
            <p className="ds-card-subtitle">
              Update display name, default project routing, or lifecycle state
            </p>
          </div>
        </div>
        <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
              Display Name
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Display name"
                className="ds-input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateSenderDisplayName(sender.id, name), "Saved.")}
                className="ds-btn ds-btn-secondary"
              >
                <Save size={13} />
                <span>Save</span>
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!sender.isDefault && usable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => setDefaultSender(sender.id), "Default sender set.")}
                className="ds-btn ds-btn-secondary ds-btn-sm"
              >
                <CheckCircle2 size={13} />
                <span>Set as default</span>
              </button>
            )}
            {sender.status !== "disabled" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => setSenderEnabled(sender.id, false), "Sender disabled.")}
                className="ds-btn ds-btn-secondary ds-btn-sm"
              >
                <Ban size={13} />
                <span>Disable sender</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => setSenderEnabled(sender.id, true), "Sender re-enabled.")}
                className="ds-btn ds-btn-secondary ds-btn-sm"
              >
                <CheckCircle2 size={13} />
                <span>Re-enable sender</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="ds-btn ds-btn-danger ds-btn-sm"
            >
              <Trash2 size={13} />
              <span>Delete sender</span>
            </button>
          </div>

          {msg && (
            <DsBanner
              tone={msg.ok ? "success" : "danger"}
              title={msg.ok ? "Updated" : "Action failed"}
              description={msg.text}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        busy={busy}
        onConfirm={async () => {
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
        title={`Delete sender ${sender.email}?`}
        description={
          sender.emailCount > 0
            ? `This sender has ${sender.emailCount} historical deliveries. Past delivery logs will be preserved, but new sends using this identity will be rejected.`
            : "Delete this sender identity? This action cannot be undone."
        }
        confirmLabel="Confirm delete"
      />
    </div>
  );
}
