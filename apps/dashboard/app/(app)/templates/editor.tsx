"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Monitor,
  Smartphone,
  Send,
  Trash2,
  Sparkles,
  Variable,
  Save,
} from "lucide-react";
import { addTemplateVersion, createTemplate, deleteTemplate, testSendTemplate } from "./actions";
import { extractVariables } from "./vars";
import { DsBanner, ConfirmDialog, StatusPill } from "../../../components/design-system";

/** Render {{vars}} with sample values client-side; HTML preview is sandboxed. */
function fillVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => vars[key] ?? m);
}

const STARTER_PRESETS = [
  {
    label: "OTP / Magic Link",
    name: "Sign-in Verification Code",
    alias: "auth-otp-code",
    subject: "Your {{app_name}} verification code is {{otp_code}}",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e5e5; border-radius: 12px;">
  <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #686b73; margin: 0 0 8px;">Security Verification</p>
  <h2 style="margin: 0 0 12px; color: #0b0c0e;">Sign in to {{app_name}}</h2>
  <p style="color: #26282d; font-size: 14px; line-height: 1.5;">Hi {{name}}, enter the one-time verification code below to complete your sign-in:</p>
  <div style="font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 0.18em; padding: 14px 18px; background: #f5f4ef; border-radius: 8px; text-align: center; margin: 18px 0;">{{otp_code}}</div>
  <p style="color: #686b73; font-size: 12px; margin: 0;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
</div>`,
    text: "Hi {{name}}, your {{app_name}} verification code is {{otp_code}}. It expires in 10 minutes.",
  },
  {
    label: "Password Reset",
    name: "Password Reset Request",
    alias: "password-reset",
    subject: "Reset your {{app_name}} password",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e5e5; border-radius: 12px;">
  <h2 style="margin: 0 0 12px; color: #0b0c0e;">Reset your password</h2>
  <p style="color: #26282d; font-size: 14px; line-height: 1.5;">Hi {{name}}, we received a request to reset the password for your account.</p>
  <p style="margin: 20px 0;"><a href="{{reset_url}}" style="background: #0b0c0e; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">Reset Password →</a></p>
  <p style="color: #686b73; font-size: 12px; margin: 0;">Link valid for 30 minutes.</p>
</div>`,
    text: "Hi {{name}}, reset your password here: {{reset_url}}",
  },
  {
    label: "Invoice Receipt",
    name: "Payment Receipt",
    alias: "invoice-receipt",
    subject: "Receipt for your {{app_name}} payment ({{amount}})",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e5e5; border-radius: 12px;">
  <h2 style="margin: 0 0 8px; color: #0b0c0e;">Payment received</h2>
  <p style="color: #686b73; font-size: 13px; margin: 0 0 16px;">Invoice #{{invoice_id}}</p>
  <p style="color: #26282d; font-size: 14px;">Thank you, {{name}}. We've processed your payment of <strong>{{amount}}</strong>.</p>
</div>`,
    text: "Thank you {{name}}. Payment of {{amount}} received for invoice #{{invoice_id}}.",
  },
];

export function TemplateEditor({
  projectId,
  mode,
  templateId,
  initial,
}: {
  projectId: string;
  mode: "create" | "edit";
  templateId?: string;
  initial?: { name?: string; alias?: string; subject?: string; html?: string; text?: string };
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [alias, setAlias] = React.useState(initial?.alias ?? "");
  const [subject, setSubject] = React.useState(initial?.subject ?? "");
  const [html, setHtml] = React.useState(initial?.html ?? "");
  const [text, setText] = React.useState(initial?.text ?? "");
  const [vars, setVars] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [testTo, setTestTo] = React.useState("");
  const [viewport, setViewport] = React.useState<"desktop" | "mobile">("desktop");
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const foundVars = extractVariables(subject, html, text);
  for (const v of foundVars) {
    if (vars[v] === undefined) vars[v] = `Sample ${v}`;
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "create") {
        const r = await createTemplate(projectId, { name, alias, subject, html, text });
        router.push(`/templates/${r.id}`);
      } else {
        const r = await addTemplateVersion(projectId, templateId!, { subject, html, text });
        setNotice(`Saved as ${r.version} — new sends use it immediately.`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const previewHtml = fillVars(
    html ||
      "<p style='color:gray;font-family:sans-serif'>No HTML body yet. Load a starter preset or write HTML on the left to preview live.</p>",
    vars,
  );

  return (
    <div>
      {mode === "create" && (
        <div
          className="ds-card"
          style={{
            marginBottom: 18,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Sparkles size={15} style={{ color: "var(--color-accent)" }} />
            <span style={{ fontWeight: 600 }}>Quick-load starter blueprint:</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STARTER_PRESETS.map((p) => (
              <button
                key={p.alias}
                type="button"
                onClick={() => {
                  setName(p.name);
                  setAlias(p.alias);
                  setSubject(p.subject);
                  setHtml(p.html);
                  setText(p.text);
                }}
                className="ds-btn ds-btn-secondary ds-btn-sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ds-grid-2" style={{ alignItems: "start" }}>
        {/* Left Pane: Source & Variable Schema */}
        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">
                {mode === "create" ? "Template Definition" : "Edit Template Source"}
              </h2>
              <p className="ds-card-subtitle">
                Use <code className="mono">{"{{variable}}"}</code> syntax in subject, HTML, or plaintext.
              </p>
            </div>
            <StatusPill
              status="active"
              label={`${foundVars.length} var${foundVars.length === 1 ? "" : "s"}`}
            />
          </div>

          <div className="ds-card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {mode === "create" && (
              <div className="ds-grid-2">
                <div>
                  <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                    Template Name
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Template name (e.g. Password reset)"
                    className="ds-input"
                  />
                </div>
                <div>
                  <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                    API Alias Slug
                  </label>
                  <input
                    value={alias}
                    onChange={(e) => setAlias(e.target.value.toLowerCase())}
                    placeholder="alias-used-in-api-calls"
                    className="ds-input mono"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                Subject Line
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject ({{variables}} OK)"
                className="ds-input"
              />
            </div>

            <div>
              <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                HTML Body
              </label>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                placeholder={"<p>Hi {{name}},</p>\n<p>Reset link: {{reset_url}}</p>"}
                rows={10}
                className="ds-textarea mono"
                style={{ fontSize: 12 }}
              />
            </div>

            <div>
              <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                Plain-text Fallback (recommended for strict spam filters)
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Plain-text fallback (optional)"
                rows={4}
                className="ds-textarea mono"
                style={{ fontSize: 12 }}
              />
            </div>

            {foundVars.length > 0 && (
              <div
                style={{
                  padding: 12,
                  borderRadius: "var(--radius-lg)",
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  <Variable size={14} style={{ color: "var(--color-accent)" }} />
                  <span>Detected Variables (Sample Preview Values)</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                  {foundVars.map((v) => (
                    <div key={v}>
                      <label className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                        {`{{${v}}}`}
                      </label>
                      <input
                        value={vars[v] ?? ""}
                        onChange={(e) => setVars({ ...vars, [v]: e.target.value })}
                        placeholder={v}
                        title={v}
                        className="ds-input"
                        style={{ height: 32, fontSize: 12, marginTop: 2 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <DsBanner tone="danger" title="Could not save template" description={error} />}
            {notice && <DsBanner tone="success" title="Template updated" description={notice} />}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                className="ds-btn ds-btn-primary"
              >
                <Save size={14} />
                <span>{mode === "create" ? "Create template" : "Save new version"}</span>
              </button>

              {mode === "edit" && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="ds-btn ds-btn-danger"
                >
                  <Trash2 size={14} />
                  <span>Delete</span>
                </button>
              )}
            </div>

            {mode === "edit" && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  borderTop: "1px solid var(--color-border)",
                  paddingTop: 14,
                  marginTop: 4,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="test recipient (e.g. yours+tpl@example.com)"
                  className="ds-input"
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    setNotice(null);
                    try {
                      const r = await testSendTemplate(projectId, templateId!, testTo, vars);
                      setNotice(`Test email accepted: ${r.emailId}. Watch it on Deliveries.`);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Test send failed.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy || !testTo}
                  className="ds-btn ds-btn-secondary"
                >
                  <Send size={13} />
                  <span>Send test email</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Live Sandboxed Preview */}
        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Live Sandboxed Preview</h2>
              <p className="ds-card-subtitle">
                Sample variables injected into isolated preview frame
              </p>
            </div>
            <div className="ds-tabs" role="tablist" aria-label="Preview viewport">
              <button
                type="button"
                role="tab"
                aria-selected={viewport === "desktop"}
                onClick={() => setViewport("desktop")}
                className={`ds-tab ${viewport === "desktop" ? "is-active" : ""}`}
              >
                <Monitor size={13} />
                <span>Desktop</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewport === "mobile"}
                onClick={() => setViewport("mobile")}
                className={`ds-tab ${viewport === "mobile" ? "is-active" : ""}`}
              >
                <Smartphone size={13} />
                <span>Mobile</span>
              </button>
            </div>
          </div>

          <div className="ds-card-body">
            <div
              style={{
                maxWidth: viewport === "mobile" ? 360 : "100%",
                margin: "0 auto",
                transition: "max-width 200ms ease",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  border: "1px solid var(--color-border)",
                  borderBottom: "none",
                  borderRadius: "10px 10px 0 0",
                  background: "var(--color-surface-elevated)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: "var(--color-muted)" }}>Subject: </span>
                <b>{fillVars(subject, vars) || "(No subject)"}</b>
              </div>
              <iframe
                sandbox=""
                title="Template preview"
                srcDoc={`<!doctype html><html><body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#ffffff;color:#0b0c0e">${previewHtml}</body></html>`}
                style={{
                  width: "100%",
                  height: 420,
                  border: "1px solid var(--color-border)",
                  borderRadius: "0 0 10px 10px",
                  background: "var(--color-surface)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await deleteTemplate(projectId, templateId!);
          router.push("/templates");
        }}
        title="Delete Template & All Versions?"
        description="Any API calls referencing this template alias will fail immediately. This action cannot be undone."
        confirmLabel="Delete template"
      />
    </div>
  );
}
