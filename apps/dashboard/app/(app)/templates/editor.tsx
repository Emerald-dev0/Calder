"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  addTemplateVersion,
  createTemplate,
  deleteTemplate,
  testSendTemplate,
} from "./actions";
import { extractVariables } from "./vars";

const inputStyle: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const areaStyle: React.CSSProperties = {
  ...inputStyle,
  height: "auto",
  minHeight: 160,
  padding: 10,
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  lineHeight: 1.5,
  resize: "vertical",
};

const btnPrimary: React.CSSProperties = {
  height: 38,
  padding: "0 18px",
  border: "none",
  borderRadius: 8,
  background: "#0B0C0E",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  height: 38,
  padding: "0 14px",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

/** Render {{vars}} with sample values client-side; HTML preview is sandboxed. */
function fillVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => vars[key] ?? m);
}

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
  const [showPreview, setShowPreview] = React.useState(true);

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
      "<p style='color:#737373;font-family:sans-serif'>No HTML body yet. Plain-text version renders in clients without HTML support.</p>",
    vars
  );

  return (
    <div>
      <div style={{ display: "grid", gap: 12, maxWidth: 760 }}>
        {mode === "create" && (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name (e.g. Password reset)" style={inputStyle} />
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value.toLowerCase())}
              placeholder="alias-used-in-api-calls"
              style={inputStyle}
            />
          </>
        )}
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject ({{variables}} OK)" style={inputStyle} />
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder={"<p>Hi {{name}},</p>\n<p>Reset link: {{reset_url}}</p>"} style={areaStyle} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Plain-text fallback (optional)" style={{ ...areaStyle, minHeight: 90 }} />

        {foundVars.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Sample values:</span>
            {foundVars.map((v) => (
              <input
                key={v}
                value={vars[v] ?? ""}
                onChange={(e) => setVars({ ...vars, [v]: e.target.value })}
                placeholder={v}
                title={v}
                style={{ ...inputStyle, width: 150, fontSize: 12 }}
              />
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => void save()} disabled={busy} style={btnPrimary}>
            {mode === "create" ? "Create template" : "Save new version"}
          </button>
          <button onClick={() => setShowPreview(!showPreview)} style={btnGhost}>
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
          {mode === "edit" && (
            <button
              onClick={async () => {
                if (!confirm("Delete this template and all its versions?")) return;
                await deleteTemplate(projectId, templateId!);
                router.push("/templates");
              }}
              style={{ ...btnGhost, color: "#DC2626" }}
            >
              Delete
            </button>
          )}
        </div>

        {error && (
          <p role="alert" style={{ color: "#DC2626", fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" style={{ color: "#16A34A", fontSize: 13, margin: 0 }}>
            {notice}
          </p>
        )}

        {mode === "edit" && (
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="test recipient (e.g. yours+tpl@example.com)" style={{ ...inputStyle, maxWidth: 340 }} />
            <button
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
              style={btnGhost}
            >
              Send test email
            </button>
          </div>
        )}
      </div>

      {showPreview && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "0 0 6px" }}>
            Preview (sample values injected, sandboxed):
          </p>
          <iframe
            sandbox=""
            title="Template preview"
            srcDoc={`<!doctype html><html><body style="margin:0;padding:16px;font-family:sans-serif"><p style="color:#737373;font-size:12px;margin:0 0 12px;padding:0">Subject: ${fillVars(subject, vars).replace(/</g, "&lt;")}</p>${previewHtml}</body></html>`}
            style={{ width: "100%", maxWidth: 760, height: 320, border: "1px solid var(--color-border)", borderRadius: 12, background: "#fff" }}
          />
        </div>
      )}
    </div>
  );
}
