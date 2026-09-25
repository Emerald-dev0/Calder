"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SenderSelector, type SenderOption } from "./sender-selector";
import { sendComposerEmail } from "./actions";

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
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </label>
      <div
        style={{
          border: "1px solid #D4D4D4",
          borderRadius: 10,
          padding: values.length > 0 ? "6px 8px" : "0 8px",
          background: "#fff",
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
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 13,
                background: bad ? "#FEF2F2" : "#F5F4EF",
                border: `1px solid ${bad ? "#FCA5A5" : "#E5E5E5"}`,
                borderRadius: 999,
                padding: "3px 4px 3px 10px",
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
            height: 38,
            fontSize: 14,
            background: "transparent",
          }}
        />
      </div>
    </div>
  );
}

/** Email composer: explicit sender, chips, collapsed advanced, honest result. */
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

  const sender = senders.find((s) => s.id === senderId) ?? null;
  const badTo = to.filter((e) => !EMAIL_RE.test(e));

  async function readFiles(
    list: File[]
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
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          padding: 32,
          textAlign: "center",
          maxWidth: 520,
        }}
      >
        <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>
          ✓ Accepted{sender ? ` as ${sender.displayName}` : ""}.
        </p>
        <p className="mono" style={{ fontSize: 12, color: "#737373", margin: "0 0 20px" }}>
          {sentId}
        </p>
        <p style={{ fontSize: 13, color: "#737373", margin: "0 0 20px" }}>
          Queued for delivery. Watch its actual state, we report acceptance only.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <a
            href={`/emails?project=${projectId}`}
            style={{
              background: "#0B0C0E",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            View delivery
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
            style={{
              background: "#fff",
              border: "1px solid #D4D4D4",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Write another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          From
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
          <p style={{ fontSize: 12, color: "#B45309", margin: "8px 0 0" }}>
            No senders on this project yet.{" "}
            <a href={`/senders?project=${projectId}`} style={{ color: "#0B0C0E" }}>
              Add one first
            </a>
            .
          </p>
        )}
      </div>

      <ChipInput label="To" values={to} onChange={setTo} placeholder="recipient@example.com" />

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Subject
        </label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Welcome to Calder"
          style={{
            width: "100%",
            height: 42,
            border: "1px solid #D4D4D4",
            borderRadius: 10,
            padding: "0 14px",
            fontSize: 14,
            background: "#fff",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Message
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Hello…"
          rows={8}
          style={{
            width: "100%",
            border: "1px solid #D4D4D4",
            borderRadius: 10,
            padding: 14,
            fontSize: 14,
            fontFamily: "inherit",
            background: "#fff",
            boxSizing: "border-box",
            resize: "vertical",
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        aria-expanded={showAdvanced}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          padding: "4px 0",
          marginBottom: 8,
        }}
      >
        Advanced options {showAdvanced ? "▾" : "▸"}
      </button>
      {showAdvanced && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            padding: 16,
            marginBottom: 14,
          }}
        >
          <ChipInput label="Cc" values={cc} onChange={setCc} placeholder="cc@example.com" />
          <ChipInput label="Bcc" values={bcc} onChange={setBcc} placeholder="bcc@example.com" />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Reply-to
            </label>
            <input
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="support@example.com"
              style={{
                width: "100%",
                height: 40,
                border: "1px solid #D4D4D4",
                borderRadius: 8,
                padding: "0 12px",
                fontSize: 14,
                background: "#fff",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Send at (optional)
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              style={{
                height: 40,
                border: "1px solid #D4D4D4",
                borderRadius: 8,
                padding: "0 12px",
                fontSize: 14,
                background: "#fff",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Attachments{" "}
              <span style={{ fontWeight: 400, color: "#737373" }}>(max 10, 25 MB total)</span>
            </label>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
              style={{ fontSize: 13 }}
            />
            {files.length > 0 && (
              <ul style={{ fontSize: 12, color: "#525252", margin: "8px 0 0", paddingLeft: 18 }}>
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
        <p className="login-error" style={{ margin: "0 0 12px" }}>
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={!canSend || busy}
          onClick={() => setConfirming(true)}
          style={{
            background: !canSend || busy ? "#A3A3A3" : "#0B0C0E",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "0 26px",
            height: 46,
            fontSize: 15,
            fontWeight: 600,
            cursor: !canSend || busy ? "not-allowed" : "pointer",
          }}
        >
          Review & send →
        </button>
      ) : (
        <div
          style={{ background: "#fff", border: "1px solid #0B0C0E", borderRadius: 12, padding: 16 }}
        >
          <p style={{ fontSize: 13, color: "#737373", margin: "0 0 4px" }}>Sending as</p>
          <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 2px" }}>{sender?.displayName}</p>
          <p className="mono" style={{ fontSize: 12, color: "#525252", margin: "0 0 4px" }}>
            {sender?.email}
          </p>
          <p style={{ fontSize: 13, color: "#737373", margin: "0 0 14px" }}>
            To {to.length} recipient{to.length > 1 ? "s" : ""}
            {scheduledAt ? ` · scheduled ${scheduledAt}` : ""}
            {files.length > 0 ? ` · ${files.length} attachment${files.length > 1 ? "s" : ""}` : ""}.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              onClick={send}
              style={{
                background: "#0B0C0E",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "0 20px",
                height: 42,
                fontSize: 14,
                fontWeight: 600,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Sending…" : "Send email →"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              style={{
                background: "#fff",
                border: "1px solid #D4D4D4",
                borderRadius: 8,
                padding: "0 18px",
                height: 42,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
