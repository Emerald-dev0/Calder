"use client";

import { useMemo, useState, useTransition } from "react";
import {
  discardDraft,
  publishEmail,
  restoreVersion,
  saveDraft,
  sendTestEmail,
  type EditorState,
} from "@/lib/control/editor-actions";

const SAMPLE_NAME = "Sarah";

/**
 * Confirmation email editor (REQ-070..075).
 * Left: settings · Center: structured content · Right: live preview (desktop/mobile).
 * Draft → preview → send test → publish → version history, never overwrite.
 */
export function EmailEditor({ initialState }: { initialState: EditorState }) {
  const [state, setState] = useState<EditorState>(initialState);
  const [subject, setSubject] = useState(initialState.subject);
  const [html, setHtml] = useState(initialState.html);
  const [text, setText] = useState(initialState.text);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<string>, okText: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await fn();
        setState((s) => ({ ...s, hasDraft: s.hasDraft || okText.startsWith("Draft") }));
        setMessage({ kind: "ok", text: result || okText });
      } catch (err) {
        setMessage({
          kind: "err",
          text: err instanceof Error ? err.message : "Something went wrong.",
        });
      }
    });
  }

  const previewHtml = useMemo(() => {
    // Preview only: render the draft with a sample name. Server-side send
    // rendering applies escaping and the branded layout at send time.
    return html
      .replaceAll("{{first_name}}", SAMPLE_NAME)
      .replaceAll("{{email}}", "sarah@example.com");
  }, [html]);

  return (
    <div className="cp-editor">
      <div className="cp-editor-status">
        <span>
          {state.currentVersion !== null ? (
            <>
              Current version · <b>v{state.currentVersion}</b>
              {state.currentPublishedAt
                ? ` · published ${new Date(state.currentPublishedAt).toISOString().slice(0, 10)}`
                : ""}
            </>
          ) : (
            "No published version yet — the shipped default copy is in use"
          )}
          {state.hasDraft ? " · unsaved draft exists" : ""}
        </span>
        <button type="button" className="cp-btn" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "Hide history" : "History"}
        </button>
      </div>

      {message ? (
        <p
          role="status"
          style={{
            fontSize: 12.5,
            color: message.kind === "ok" ? "var(--cp-ok)" : "var(--cp-bad)",
            margin: "0 0 10px",
          }}
        >
          {message.text}
        </p>
      ) : null}

      {showHistory ? (
        <div className="cp-panel" style={{ marginBottom: 14 }}>
          <div className="cp-panel-head">
            <h2 className="cp-panel-title">Version history</h2>
            <span className="cp-panel-caption">
              Immutable · restore copies a version into your draft
            </span>
          </div>
          <div className="cp-panel-body cp-flush">
            {state.versions.length === 0 ? (
              <div className="cp-empty">
                <b>No versions yet</b>
                The first publish creates v1.
              </div>
            ) : (
              state.versions.map((v) => (
                <div className="cp-healthrow" key={v.id}>
                  <span className="cp-health-name mono">v{v.version}</span>
                  <span
                    style={{
                      color: "var(--cp-muted)",
                      fontSize: 12.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {v.subject}
                  </span>
                  <span className="cp-health-state mono">
                    {v.publishedAt.slice(0, 10)}
                    {v.publishedBy ? ` · ${v.publishedBy}` : ""}
                  </span>
                  <button
                    type="button"
                    className="cp-topbar-control"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        await restoreVersion(v.version);
                        const s = await import("@/lib/control/editor-actions").then((m) =>
                          m.getEditorState()
                        );
                        setSubject(s.subject);
                        setHtml(s.html);
                        setText(s.text);
                        setState(s);
                        return `Restored v${v.version} into the draft.`;
                      }, "restore")
                    }
                  >
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="cp-editor-grid">
        {/* LEFT — settings */}
        <section className="cp-panel">
          <div className="cp-panel-head">
            <h2 className="cp-panel-title">Settings</h2>
          </div>
          <div className="cp-panel-body">
            <label className="cp-field">
              <span className="cp-field-label">Subject</span>
              <input
                className="cp-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={998}
              />
            </label>
            <label className="cp-field">
              <span className="cp-field-label">Preview text</span>
              <input
                className="cp-input"
                value={text.split("\n")[0] ?? ""}
                onChange={(e) =>
                  setText(e.target.value + "\n" + text.split("\n").slice(1).join("\n"))
                }
                maxLength={200}
              />
            </label>
            <label className="cp-field">
              <span className="cp-field-label">From</span>
              <input className="cp-input" value="Calder <hello@calder.click>" disabled />
            </label>
            <label className="cp-field">
              <span className="cp-field-label">Reply-to</span>
              <input className="cp-input" value="support@calder.click" disabled />
            </label>
            <div className="cp-field">
              <span className="cp-field-label">Variables</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["{{first_name}}", "{{email}}", "{{referral_code}}", "{{referral_link}}"].map(
                  (v) => (
                    <button
                      key={v}
                      type="button"
                      className="cp-series"
                      onClick={() => {
                        setHtml((h) => `${h} ${v}`);
                      }}
                      title={`Insert ${v} into the body`}
                    >
                      <span className="mono" style={{ fontSize: 11 }}>
                        {v}
                      </span>
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CENTER — content */}
        <section className="cp-panel">
          <div className="cp-panel-head">
            <h2 className="cp-panel-title">Content</h2>
            <span className="cp-panel-caption">
              HTML body · rendered inside the Calder layout at send time
            </span>
          </div>
          <div className="cp-panel-body">
            <label className="cp-field">
              <span className="cp-field-label">Body HTML</span>
              <textarea
                className="cp-input"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                rows={18}
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  resize: "vertical",
                }}
                spellCheck={false}
              />
            </label>
            <label className="cp-field">
              <span className="cp-field-label">Plain-text alternative</span>
              <textarea
                className="cp-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  resize: "vertical",
                }}
                spellCheck={false}
              />
            </label>
          </div>
        </section>

        {/* RIGHT — preview */}
        <section className="cp-panel">
          <div className="cp-panel-head">
            <h2 className="cp-panel-title">Preview</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="cp-series"
                data-on={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                Desktop
              </button>
              <button
                type="button"
                className="cp-series"
                data-on={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                Mobile
              </button>
            </div>
          </div>
          <div className="cp-panel-body">
            <div
              style={{
                border: "1px solid var(--cp-border)",
                borderRadius: 10,
                background: "#f5f4ef",
                margin: "0 auto",
                maxWidth: device === "mobile" ? 390 : "100%",
                transition: "max-width 160ms ease",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid #eceae2",
                  fontSize: 11,
                  color: "#737373",
                }}
              >
                <div>
                  <b style={{ color: "#0b0c0e" }}>{subject || "(no subject)"}</b>
                </div>
                <div className="mono">Calder &lt;hello@calder.click&gt;</div>
              </div>
              <iframe
                title="Email preview"
                srcDoc={`<!doctype html><html><body style="margin:0;background:#f5f4ef;">${previewHtml}</body></html>`}
                style={{ width: "100%", height: 480, border: "none", background: "transparent" }}
                sandbox=""
              />
            </div>
          </div>
        </section>
      </div>

      <div className="cp-editor-actions">
        <button
          type="button"
          className="cp-btn"
          disabled={pending}
          onClick={() =>
            run(async () => {
              await saveDraft({ subject, html, text });
              return "Draft saved.";
            }, "Draft")
          }
        >
          Save draft
        </button>
        <button
          type="button"
          className="cp-btn"
          disabled={pending || !testTo.trim()}
          onClick={() =>
            run(async () => {
              await sendTestEmail({ to: testTo, subject, html, text });
              return `Test sent to ${testTo} (marked [TEST], excluded from analytics).`;
            }, "test")
          }
        >
          Send test →
        </button>
        <input
          className="cp-input"
          type="email"
          placeholder="founder@example.com"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          style={{ maxWidth: 240 }}
          aria-label="Send test to"
        />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="cp-btn"
          disabled={pending || !state.hasDraft}
          onClick={() =>
            run(async () => {
              await discardDraft();
              return "Draft discarded.";
            }, "")
          }
        >
          Discard draft
        </button>
        <button
          type="button"
          className="cp-btn primary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await publishEmail({ subject, html, text });
              const s = await import("@/lib/control/editor-actions").then((m) =>
                m.getEditorState()
              );
              setState(s);
              return `Published as v${result.version}.`;
            }, "publish")
          }
        >
          Publish
        </button>
      </div>
      <p className="cp-caption">
        Test sends never enter the waitlist, never modify analytics, and are marked [TEST].
        Publishing materializes the draft for the signup pipeline and records an immutable version.
      </p>
    </div>
  );
}
