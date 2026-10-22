"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Send,
  Trash2,
  Archive,
  CornerUpLeft,
  KeyRound,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import {
  setSenderDefault,
  updateSenderDisplayName,
  setSenderReplyTo,
  setSenderEnabled,
  deleteSender,
  unarchiveSender,
  testSend,
  testSendStatus,
  setSenderAllowedKeys,
} from "../actions";
import {
  DsBanner,
  ConfirmDialog,
  DsSwitch,
  StatusPill,
} from "../../../../components/design-system";
import type { DispatchStatus } from "../../../../lib/senders/service";

export interface SenderDetailTarget {
  id: string;
  projectId: string;
  displayName: string;
  email: string;
  type: string;
  status: string;
  isDefault: boolean;
  isDefaultMarketing: boolean;
  replyTo: string | null;
  archived: boolean;
  emailCount: number;
}

export interface KeyOption {
  id: string;
  name: string;
  env: string;
  keyPrefix: string;
}

const TERMINAL = new Set(["delivered", "bounced", "complained", "failed"]);

/**
 * All sender mutations live here: defaults, Reply-To, allowed keys, enable /
 * disable, test send, archive. Every destructive action names its target in the
 * confirmation, and the test-send row polls the real status until the message
 * reaches a terminal state — it never says "delivered" on its own.
 */
export function SenderDetailActions({
  sender,
  apiKeys,
  allowedKeyIds,
}: {
  sender: SenderDetailTarget;
  apiKeys: KeyOption[];
  allowedKeyIds: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(sender.displayName);
  const [replyTo, setReplyTo] = useState(sender.replyTo ?? "");
  const [keys, setKeys] = useState<string[]>(allowedKeyIds);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [tracked, setTracked] = useState<{ emailId: string; status: DispatchStatus | null } | null>(
    null
  );
  const [testErr, setTestErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usable =
    (sender.status === "verified" || sender.status === "connected") && !sender.archived;

  const run = useCallback(
    async (fn: () => Promise<unknown>, okText: string) => {
      setBusy(true);
      setMsg(null);
      try {
        await fn();
        setMsg({ text: okText, ok: true });
        router.refresh();
      } catch (err) {
        setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
      }
      setBusy(false);
    },
    [router]
  );

  // Poll the dispatched test message until a terminal status is observed. The
  // row itself is the record: each poll replaces what the provider last said.
  useEffect(() => {
    if (!tracked || tracked.status?.terminal) return;
    const delay = tracked.status ? 4000 : 2000;
    timer.current = setTimeout(async () => {
      try {
        const next = await testSendStatus(sender.projectId, tracked.emailId);
        setTracked({ emailId: tracked.emailId, status: next });
      } catch {
        setTestErr("Lost track of the test message. Open the Emails page to check it.");
        setTracked(null);
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tracked, sender.projectId]);

  const archivedKeys = keys.length > 0;

  return (
    <div className="ds-grid-2">
      {/* ── Dispatch verification email ─────────────────────────── */}
      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Dispatch Verification Email</h2>
            <p className="ds-card-subtitle">
              Send one real email through this sender. The row updates as the provider reports back.
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
              disabled={testBusy || !usable || !testTo.trim()}
              onClick={async () => {
                setTestBusy(true);
                setTestErr(null);
                try {
                  const res = await testSend(sender.id, testTo);
                  setTracked({ emailId: res.emailId, status: null });
                  setTestTo("");
                } catch (err) {
                  setTestErr(err instanceof Error ? err.message : "Could not dispatch.");
                }
                setTestBusy(false);
              }}
              className="ds-btn ds-btn-primary"
            >
              <Send size={14} />
              <span>{testBusy ? "Dispatching…" : "Send test"}</span>
            </button>
          </div>

          {!usable && (
            <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "10px 0 0" }}>
              {sender.archived
                ? "Restore this sender to dispatch a test."
                : `This sender is ${sender.status}. Enable it before testing.`}
            </p>
          )}

          {testErr && (
            <div style={{ marginTop: 10 }}>
              <DsBanner tone="danger" title="Test send failed" description={testErr} />
            </div>
          )}

          {tracked && (
            <div
              className="ds-kv"
              style={{
                marginTop: 12,
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: 12,
              }}
              data-testid="test-send-row"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {tracked.emailId}
                  </span>
                  <StatusPill status={tracked.status?.status ?? "queued"} />
                  {tracked.status?.terminal && (
                    <CheckCircle2 size={14} color="var(--color-success)" />
                  )}
                </div>
                {!tracked.status?.terminal && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--color-muted)",
                    }}
                  >
                    <RefreshCw size={12} />
                    checking…
                  </span>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "8px 0 0" }}>
                {tracked.status
                  ? `Last provider event set the status to “${tracked.status.status}” at ${new Date(
                      tracked.status.updatedAt
                    ).toLocaleTimeString()}.`
                  : "Accepted by the queue. Waiting for the worker to pick it up…"}
              </p>
              {tracked.status?.lastError && (
                <p style={{ fontSize: 12, color: "var(--color-danger)", margin: "6px 0 0" }}>
                  Provider error: {tracked.status.lastError}
                </p>
              )}
              {tracked.status && tracked.status.events.length > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 6 }}>
                  {tracked.status.events.map((e) => e.type).join(" → ")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Identity ────────────────────────────────────────────── */}
      <div className="ds-card">
        <div className="ds-card-header">
          <h2 className="ds-card-title">Identity</h2>
        </div>
        <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
              Display name
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="ds-input"
                style={{ flex: 1 }}
                disabled={sender.archived}
              />
              <button
                type="button"
                className="ds-btn ds-btn-secondary"
                disabled={busy || sender.archived || name.trim() === sender.displayName}
                onClick={() =>
                  run(() => updateSenderDisplayName(sender.id, name), "Display name updated.")
                }
              >
                <Save size={14} />
                <span>Save</span>
              </button>
            </div>
          </div>

          <div>
            <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
              Reply-To
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                type="email"
                placeholder={`defaults to ${sender.email}`}
                className="ds-input mono"
                style={{ flex: 1 }}
                disabled={sender.archived}
              />
              <button
                type="button"
                className="ds-btn ds-btn-secondary"
                disabled={busy || sender.archived || replyTo.trim() === (sender.replyTo ?? "")}
                onClick={() =>
                  run(
                    () => setSenderReplyTo(sender.id, replyTo.trim() || null),
                    replyTo.trim() ? "Reply-To saved." : "Reply-To cleared."
                  )
                }
              >
                <Save size={14} />
                <span>Save</span>
              </button>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "6px 0 0" }}>
              Applied to every message sent from this identity. Leave empty to reply to the From
              address.
            </p>
          </div>

          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <DsSwitch
              checked={sender.isDefault}
              disabled={busy || sender.archived || !usable}
              onChange={(next) =>
                run(
                  () => setSenderDefault(sender.id, "transactional", next),
                  next ? "Set as transactional default." : "Transactional default cleared."
                )
              }
              label="Default for transactional"
              description="Used when an API call doesn't name a sender. Verified senders only."
            />
          </div>
          <div>
            <DsSwitch
              checked={sender.isDefaultMarketing}
              disabled={busy || sender.archived || !usable}
              onChange={(next) =>
                run(
                  () => setSenderDefault(sender.id, "marketing", next),
                  next ? "Set as broadcast default." : "Broadcast default cleared."
                )
              }
              label="Default for broadcasts"
              description="Used for marketing-stream campaigns. Separate from the transactional default."
            />
          </div>

          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <DsSwitch
              checked={!sender.archived && usable}
              disabled={busy || sender.archived}
              onChange={(next) =>
                run(
                  () => setSenderEnabled(sender.id, next),
                  next ? "Sender enabled." : "Sender disabled — it can no longer send."
                )
              }
              label={usable ? "Enabled" : "Disabled"}
              description={
                usable
                  ? "Disable to stop all sending from this address without removing it."
                  : "Re-enabling re-checks the domain or Gmail connection first."
              }
            />
          </div>
        </div>
      </div>

      {/* ── Allowed API keys ────────────────────────────────────── */}
      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Allowed API Keys</h2>
            <p className="ds-card-subtitle">
              {archivedKeys
                ? `${keys.length} key${keys.length === 1 ? "" : "s"} may use this sender.`
                : "No restrictions — every API key in this project may use this sender."}
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          {apiKeys.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
              This project has no active API keys yet.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {apiKeys.map((k) => {
                  const checked = keys.includes(k.id);
                  return (
                    <label
                      key={k.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) =>
                          setKeys((prev) =>
                            e.target.checked ? [...prev, k.id] : prev.filter((id) => id !== k.id)
                          )
                        }
                      />
                      <KeyRound size={13} style={{ color: "var(--color-muted)" }} />
                      <span style={{ fontWeight: 600 }}>{k.name}</span>
                      <span
                        className="mono"
                        style={{ fontSize: 11.5, color: "var(--color-muted)" }}
                      >
                        {k.keyPrefix}… · {k.env}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="ds-btn ds-btn-primary ds-btn-sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setSenderAllowedKeys(sender.id, keys),
                      keys.length === 0
                        ? "Restrictions removed — every key may use this sender."
                        : "Allowed keys saved."
                    )
                  }
                >
                  <Save size={13} />
                  <span>Save restrictions</span>
                </button>
                {archivedKeys && (
                  <button
                    type="button"
                    className="ds-btn ds-btn-secondary ds-btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setKeys([]);
                      void run(
                        () => setSenderAllowedKeys(sender.id, []),
                        "Restrictions removed — every key may use this sender."
                      );
                    }}
                  >
                    <span>Clear (unrestricted)</span>
                  </button>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "10px 0 0" }}>
                No boxes ticked means unrestricted. Grant rows are stored now; the API will start
                enforcing them from the API keys page.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Danger zone ─────────────────────────────────────────── */}
      <div className="ds-card">
        <div className="ds-card-header">
          <h2 className="ds-card-title">Remove this sender</h2>
        </div>
        <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {msg && (
            <p
              role="status"
              style={{
                margin: 0,
                fontSize: 13,
                color: msg.ok ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              {msg.text}
            </p>
          )}
          <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
            {sender.emailCount > 0
              ? `${sender.emailCount.toLocaleString()} messages were sent from this address. It will be archived, not deleted — the delivery history keeps its sender, and the address stops being selectable.`
              : "This sender has never sent a message, so it can be deleted outright."}
          </p>
          {sender.archived ? (
            <button
              type="button"
              className="ds-btn ds-btn-secondary"
              disabled={busy}
              onClick={() => run(() => unarchiveSender(sender.id), "Sender restored.")}
            >
              <CornerUpLeft size={14} />
              <span>Restore sender</span>
            </button>
          ) : (
            <button
              type="button"
              className="ds-btn ds-btn-danger"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={14} />
              <span>{sender.emailCount > 0 ? "Archive sender" : "Delete sender"}</span>
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={busy}
        title={sender.emailCount > 0 ? `Archive ${sender.email}?` : `Delete ${sender.email}?`}
        description={
          sender.emailCount > 0
            ? `${sender.email} will disappear from every picker and free its plan slot. ${sender.emailCount.toLocaleString()} messages keep their record and stay attributable to this address. You can restore it later.`
            : `${sender.email} has no delivery history and will be permanently deleted. This cannot be undone.`
        }
        confirmLabel={sender.emailCount > 0 ? "Archive sender" : "Delete permanently"}
        confirmPhrase={sender.emailCount > 0 ? undefined : sender.email}
        onConfirm={async () => {
          setBusy(true);
          try {
            const result = await deleteSender(sender.id);
            setConfirming(false);
            if (result.mode === "archived") {
              setMsg({ text: `${sender.email} archived.`, ok: true });
              router.refresh();
            } else {
              router.push(`/senders?project=${sender.projectId}`);
            }
          } catch (err) {
            setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
            setConfirming(false);
          }
          setBusy(false);
        }}
      />

      {sender.archived && (
        <p style={{ fontSize: 12, color: "var(--color-muted)", gridColumn: "1 / -1" }}>
          <Archive size={12} /> Archived senders are excluded from plan counts and from every sender
          picker.
        </p>
      )}
    </div>
  );
}
