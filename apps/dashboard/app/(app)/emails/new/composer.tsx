"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Monitor,
  Smartphone,
  Code2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Paperclip,
} from "lucide-react";
import { SenderSelector, type SenderOption } from "./sender-selector";
import { sendComposerEmail } from "./actions";
import { CodeBlock, DsBanner, StatusPill } from "../../../../components/design-system";

const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{2,}$/;

function ChipInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const parts = draft
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange([...new Set([...values, ...parts])]);
    setDraft("");
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
        {label}
      </label>
      <div
        style={{
          border: "1px solid var(--color-border-strong)",
          borderRadius: "var(--radius-md)",
          padding: values.length > 0 ? "5px 8px" : "0 10px",
          background: "var(--color-surface)",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
        }}
        onClick={(e) => {
          const input = (e.currentTarget as HTMLElement).querySelector("input");
          input?.focus();
        }}
      >
        {values.map((v) => {
          const bad = !EMAIL_RE.test(v);
          return (
            <span
              key={v}
              className="mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                background: bad ? "var(--color-danger-bg)" : "var(--color-surface-elevated)",
                color: bad ? "var(--color-danger)" : "var(--color-ink)",
                border: `1px solid ${
                  bad ? "var(--color-danger-border)" : "var(--color-border)"
                }`,
                borderRadius: 999,
                padding: "2px 6px 2px 10px",
              }}
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : ""}
          aria-label={`${label} addresses`}
          style={{
            flex: 1,
            minWidth: 140,
            border: "none",
            outline: "none",
            height: 34,
            fontSize: 13.5,
            color: "var(--color-ink)",
            background: "transparent",
          }}
        />
      </div>
    </div>
  );
}

/** Split-pane Email Composer with live Desktop/Mobile preview & API code generator. */
export function Composer({
  projectId,
  senders,
  defaultSenderId,
}: {
  projectId: string;
  senders: SenderOption[];
  defaultSenderId: string | null;
}) {
  const router = useRouter();
  const [senderId, setSenderId] = useState<string | null>(defaultSenderId);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile" | "api">("desktop");

  const sender = senders.find((s) => s.id === senderId) ?? null;
  const badTo = to.filter((e) => !EMAIL_RE.test(e));

  async function readFiles(
    list: File[],
  ): Promise<Array<{ filename: string; contentType?: string; contentBase64: string }>> {
    const out = [];
    for (const f of list.slice(0, 10)) {
      const buf = await f.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      out.push({
        filename: f.name,
        contentType: f.type || undefined,
        contentBase64: btoa(bin),
      });
    }
    return out;
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const attachments = await readFiles(files);
      const total = attachments.reduce((n, a) => n + a.contentBase64.length, 0);
      if (total > 25 * 1024 * 1024) throw new Error("Attachments exceed 25 MB in total.");
      const r = await sendComposerEmail({
        projectId,
        senderId: senderId ?? "",
        to,
        cc,
        bcc,
        subject,
        text,
        replyTo: replyTo.trim() || undefined,
        scheduledAt: scheduledAt || undefined,
        attachments,
      });
      setSentId(r.emailId);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    }
    setBusy(false);
  }

  const canSend =
    sender !== null &&
    to.length > 0 &&
    badTo.length === 0 &&
    subject.trim() !== "" &&
    text.trim() !== "";

  if (sentId) {
    return (
      <div
        className="ds-card"
        style={{
          padding: 36,
          textAlign: "center",
          maxWidth: 540,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--color-success-bg)",
            color: "var(--color-success)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <CheckCircle2 size={22} />
        </div>
        <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>
          Accepted for delivery{sender ? ` as ${sender.displayName}` : ""}
        </p>
        <p
          className="mono"
          style={{ fontSize: 12, color: "var(--color-muted)", margin: "0 0 16px" }}
        >
          {sentId}
        </p>
        <p style={{ fontSize: 13.5, color: "var(--color-muted)", margin: "0 0 22px" }}>
          Queued for SES worker dispatch. Watch its live state in the Message Explorer—we report acceptance honestly and mark Delivered only upon remote MX confirmation.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <a
            href={`/emails?project=${projectId}`}
            className="ds-btn ds-btn-primary"
            style={{ textDecoration: "none" }}
          >
            View delivery timeline
          </a>
          <button
            type="button"
            onClick={() => {
              setSentId(null);
              setTo([]);
              setSubject("");
              setText("");
              setFiles([]);
              setConfirming(false);
            }}
            className="ds-btn ds-btn-secondary"
          >
            Compose another
          </button>
        </div>
      </div>
    );
  }

  const apiPayload = JSON.stringify(
    {
      from: sender ? `${sender.displayName} <${sender.email}>` : "sender@yourdomain.com",
      to: to.length > 0 ? to : ["recipient@example.com"],
      ...(cc.length > 0 ? { cc } : {}),
      ...(bcc.length > 0 ? { bcc } : {}),
      subject: subject || "Welcome to Calder",
      text: text || "Hello from Calder transactional email.",
      ...(replyTo ? { reply_to: replyTo } : {}),
    },
    null,
    2,
  );

  return (
    <div className="ds-grid-2" style={{ alignItems: "start" }}>
      {/* Left Pane: Composer Form */}
      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Compose Message</h2>
            <p className="ds-card-subtitle">
              Explicit verified sender identity, recipient validation, and idempotency protection.
            </p>
          </div>
          <StatusPill status={canSend ? "active" : "pending"} label={canSend ? "Ready" : "Draft"} />
        </div>

        <div className="ds-card-body">
          <div style={{ marginBottom: 14 }}>
            <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
              From (Verified Sender Identity)
            </label>
            <SenderSelector
              senders={senders}
              value={senderId}
              onChange={(id) => {
                setSenderId(id);
                setConfirming(false);
              }}
            />
            {senders.length === 0 && (
              <div style={{ marginTop: 10 }}>
                <DsBanner
                  tone="warning"
                  title="No verified senders on this project yet"
                  description={
                    <span>
                      Register and verify a sender address before dispatching outbound messages.{" "}
                      <a
                        href={`/senders?project=${projectId}`}
                        style={{ color: "var(--color-ink)", fontWeight: 600 }}
                      >
                        Add a sender identity →
                      </a>
                    </span>
                  }
                />
              </div>
            )}
          </div>

          <ChipInput
            label="To"
            values={to}
            onChange={setTo}
            placeholder="recipient@example.com (press Enter or comma)"
          />

          <div style={{ marginBottom: 14 }}>
            <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Welcome to Calder"
              className="ds-input"
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
              Message Body
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your transactional message or paste HTML…"
              rows={8}
              className="ds-textarea"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            aria-expanded={showAdvanced}
            className="ds-btn ds-btn-ghost ds-btn-sm"
            style={{ marginBottom: 10, paddingLeft: 4 }}
          >
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Advanced options (Cc, Bcc, Reply-To, Schedule, Attachments)</span>
          </button>

          {showAdvanced && (
            <div
              style={{
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                padding: 14,
                marginBottom: 14,
              }}
            >
              <ChipInput label="Cc" values={cc} onChange={setCc} placeholder="cc@example.com" />
              <ChipInput label="Bcc" values={bcc} onChange={setBcc} placeholder="bcc@example.com" />
              <div style={{ marginBottom: 14 }}>
                <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                  Reply-to
                </label>
                <input
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@example.com"
                  className="ds-input"
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                  Send at (optional scheduled dispatch)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="ds-input"
                />
              </div>
              <div>
                <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                  <Paperclip size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                  Attachments{" "}
                  <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>
                    (max 10 files, 25 MB total)
                  </span>
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
                  style={{ fontSize: 12.5 }}
                />
                {files.length > 0 && (
                  <ul
                    className="mono"
                    style={{
                      fontSize: 11.5,
                      color: "var(--color-muted)",
                      margin: "8px 0 0",
                      paddingLeft: 18,
                    }}
                  >
                    {files.map((f) => (
                      <li key={f.name + f.size}>
                        {f.name} · {(f.size / 1024).toFixed(0)} KB
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 12 }}>
              <DsBanner tone="danger" title="Send failed" description={error} />
            </div>
          )}

          {!confirming ? (
            <button
              type="button"
              disabled={!canSend || busy}
              onClick={() => setConfirming(true)}
              className="ds-btn ds-btn-primary ds-btn-lg"
              style={{ width: "100%" }}
            >
              <Send size={15} />
              <span>Review & send →</span>
            </button>
          ) : (
            <div
              style={{
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-ink)",
                borderRadius: "var(--radius-lg)",
                padding: 16,
              }}
            >
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "0 0 4px" }}>
                Confirm outbound dispatch as
              </p>
              <p style={{ fontSize: 14.5, fontWeight: 700, margin: "0 0 2px" }}>
                {sender?.displayName}
              </p>
              <p
                className="mono"
                style={{ fontSize: 12, color: "var(--color-muted)", margin: "0 0 6px" }}
              >
                {sender?.email}
              </p>
              <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: "0 0 14px" }}>
                To {to.length} recipient{to.length > 1 ? "s" : ""}
                {scheduledAt ? ` · scheduled ${scheduledAt}` : ""}
                {files.length > 0
                  ? ` · ${files.length} attachment${files.length > 1 ? "s" : ""}`
                  : ""}
                .
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={send}
                  className="ds-btn ds-btn-primary"
                >
                  <Send size={14} />
                  <span>{busy ? "Sending…" : "Send email →"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="ds-btn ds-btn-secondary"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Pane: Live Envelope Preview & Equivalent API Request */}
      <div className="ds-card">
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Live Message Preview</h2>
            <p className="ds-card-subtitle">
              Inspect how recipients and API clients see this payload
            </p>
          </div>
          <div className="ds-tabs" role="tablist" aria-label="Preview mode">
            <button
              type="button"
              role="tab"
              aria-selected={previewDevice === "desktop"}
              onClick={() => setPreviewDevice("desktop")}
              className={`ds-tab ${previewDevice === "desktop" ? "is-active" : ""}`}
            >
              <Monitor size={13} />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={previewDevice === "mobile"}
              onClick={() => setPreviewDevice("mobile")}
              className={`ds-tab ${previewDevice === "mobile" ? "is-active" : ""}`}
            >
              <Smartphone size={13} />
              <span>Mobile</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={previewDevice === "api"}
              onClick={() => setPreviewDevice("api")}
              className={`ds-tab ${previewDevice === "api" ? "is-active" : ""}`}
            >
              <Code2 size={13} />
              <span>API Request</span>
            </button>
          </div>
        </div>

        <div className="ds-card-body">
          {previewDevice === "api" ? (
            <CodeBlock
              title="POST /v1/emails"
              tabs={[
                {
                  id: "curl",
                  label: "cURL",
                  code: `curl -X POST https://api.calder.build/v1/emails \\
  -H "Authorization: Bearer $CALDER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${apiPayload}'`,
                },
                {
                  id: "json",
                  label: "JSON Body",
                  code: apiPayload,
                },
              ]}
            />
          ) : (
            <div
              style={{
                maxWidth: previewDevice === "mobile" ? 340 : "100%",
                margin: "0 auto",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-lg)",
                background: "var(--color-surface-elevated)",
                overflow: "hidden",
                transition: "max-width 200ms ease",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "var(--color-muted)" }}>From:</span>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {sender ? `${sender.displayName} <${sender.email}>` : "Select a sender"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "var(--color-muted)" }}>To:</span>
                  <span className="mono">
                    {to.length > 0 ? to.join(", ") : "recipient@example.com"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--color-muted)" }}>Subject:</span>
                  <span style={{ fontWeight: 700 }}>{subject || "(No subject yet)"}</span>
                </div>
              </div>
              <div
                style={{
                  padding: 20,
                  minHeight: 220,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  color: text ? "var(--color-ink)" : "var(--color-muted)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {text || "Start typing your message body on the left to preview it live here…"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
