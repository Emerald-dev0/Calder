"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldBan, Trash2, Upload, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  ConfirmDialog,
  DsBanner,
  DsButton,
  DsSelect,
  StatusPill,
  useToast,
} from "../../../components/design-system";
import {
  addSuppression,
  commitSuppressionImport,
  previewSuppressionImport,
  removeSuppression,
  type ImportPreview,
} from "./actions";
import { ADDABLE_REASONS, reasonMeta, removalIsDangerous } from "../../../lib/suppressions/reasons";

/**
 * Row-level remove.
 *
 * Removing a bounce or a complaint undoes a signal the provider gave us, so it
 * asks the operator to type the address. Ordinary manual rows get a plain
 * confirm naming the address.
 */
export function SuppressionRowAction({
  projectId,
  row,
}: {
  projectId: string;
  row: { id: string; email: string; reason: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const dangerous = removalIsDangerous(row.reason);
  const meta = reasonMeta(row.reason);

  async function confirm() {
    setBusy(true);
    try {
      await removeSuppression(projectId, row.id);
      toast({
        tone: "success",
        title: "Suppression removed",
        description: `${row.email} can receive mail again.`,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast({
        tone: "danger",
        title: "Could not remove suppression",
        description: e instanceof Error ? e.message : "Unknown error.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DsButton variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Trash2 size={12} />
        <span>Unblock</span>
      </DsButton>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        busy={busy}
        title={dangerous ? "Remove a deliverability record?" : "Remove this suppression?"}
        description={
          dangerous
            ? `${row.email} was suppressed because of a ${meta.label.toLowerCase()}. Removing it allows mail to an address the provider told us is undeliverable or hostile — this can damage the sending reputation shared by every project in this workspace. Type the address to confirm.`
            : `Mail to ${row.email} will be attempted again.`
        }
        confirmLabel={dangerous ? "Remove anyway" : "Remove"}
        confirmPhrase={dangerous ? row.email : undefined}
        danger
      />
    </>
  );
}

/**
 * Add panel: manual entry and CSV import.
 *
 * The import is a four-step flow in one dialog (upload → preview → confirm →
 * result) because a silent bulk write into a deliverability list is the kind of
 * thing that should require seeing a count first.
 */
export function SuppressionAddPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("manual");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [csv, setCsv] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string>("");
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<{
    inserted: number;
    skippedExisting: number;
    skippedInvalid: number;
    skippedDuplicate: number;
  } | null>(null);

  const emailValid = email === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addSuppression(projectId, email, reason);
      toast({ tone: "success", title: "Address blocked", description: email.trim() });
      setEmail("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add suppression.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    if (file.size > 2_000_000) {
      setError("File is larger than 2 MB. Split it into smaller files.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setImporting(true);
    try {
      const p = await previewSuppressionImport(projectId, text);
      setPreview(p);
    } catch (e) {
      setCsv(null);
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!csv) return;
    setImporting(true);
    try {
      const r = await commitSuppressionImport(projectId, csv);
      setResult(r);
      setPreview(null);
      setCsv(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="ds-card">
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Add to suppression list</h2>
          <p className="ds-card-subtitle">
            Hard bounces and spam complaints are recorded automatically. Block a recipient by hand,
            or import a list.
          </p>
        </div>
      </div>

      <div className="ds-card-body">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="suppress-email" className="ds-label">
              Email address
            </label>
            <input
              id="suppress-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="block@this-address.com"
              className="ds-input mono"
              aria-invalid={!emailValid}
              aria-describedby={!emailValid ? "suppress-email-error" : undefined}
            />
            {!emailValid && (
              <p id="suppress-email-error" className="ds-field-error">
                Enter a valid email address.
              </p>
            )}
          </div>
          <div style={{ minWidth: 190 }}>
            <label htmlFor="suppress-reason" className="ds-label">
              Reason
            </label>
            <DsSelect
              id="suppress-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {ADDABLE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </DsSelect>
          </div>
          <DsButton onClick={add} disabled={busy || !email || !emailValid} loading={busy}>
            <ShieldBan size={14} />
            <span>Block address</span>
          </DsButton>
        </div>

        <p style={{ marginTop: 8, fontSize: 12, color: "var(--color-muted)" }}>
          {reasonMeta(reason).hint}
        </p>

        {error && (
          <div style={{ marginTop: 12 }}>
            <DsBanner tone="danger" title="Could not complete" description={error} />
          </div>
        )}

        <hr className="ds-divider" style={{ margin: "20px 0" }} />

        {/* ── CSV import ─────────────────────────────────────────────────── */}
        <h3 className="ds-label" style={{ marginBottom: 6 }}>
          Import a CSV
        </h3>
        <p style={{ fontSize: 12.5, color: "var(--color-muted)", marginBottom: 12 }}>
          One address per line, or a file with <code className="mono">email</code> and{" "}
          <code className="mono">reason</code> columns. Reasons outside the reviewed set are
          imported as <code className="mono">import</code>.
        </p>

        {!preview && !result && (
          <label
            className="ds-btn ds-btn-secondary"
            style={{ cursor: "pointer", display: "inline-flex" }}
          >
            <Upload size={14} />
            <span>{importing ? "Reading…" : "Choose CSV file"}</span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: "none" }}
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {preview && (
          <div>
            <div
              style={{
                display: "flex",
                gap: 18,
                flexWrap: "wrap",
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <span className="mono">
                <FileText size={13} /> {fileName}
              </span>
              <span>
                <b className="tabular-nums">{preview.valid}</b> to add
              </span>
              <span style={{ color: "var(--color-muted)" }}>
                <b className="tabular-nums">{preview.existing}</b> already suppressed
              </span>
              <span style={{ color: "var(--color-muted)" }}>
                <b className="tabular-nums">{preview.duplicate}</b> repeated in file
              </span>
              <span style={{ color: preview.invalid ? "var(--color-danger)" : undefined }}>
                <b className="tabular-nums">{preview.invalid}</b> invalid
              </span>
            </div>

            {preview.rows.length > 0 && (
              <div className="ds-table-shell" style={{ maxHeight: 320, overflow: "auto" }}>
                <div className="ds-table-scroll">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Line</th>
                        <th>Address</th>
                        <th style={{ width: 140 }}>Reason</th>
                        <th style={{ width: 200 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 100).map((r, i) => (
                        <tr key={`${r.line}-${i}`}>
                          <td className="mono tabular-nums">{r.line}</td>
                          <td className="mono" style={{ fontSize: 12.5 }}>
                            {r.email}
                          </td>
                          <td style={{ fontSize: 12.5 }}>{reasonMeta(r.reason).label}</td>
                          <td>
                            {r.status === "valid" ? (
                              <StatusPill status="verified" label="Will add" />
                            ) : r.status === "invalid" ? (
                              <StatusPill status="failed" label="Invalid" />
                            ) : (
                              <StatusPill status="pending" label={r.status} />
                            )}
                            {r.message && (
                              <span
                                style={{ marginLeft: 8, fontSize: 11.5, color: "var(--color-muted)" }}
                              >
                                {r.message}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <DsButton
                onClick={confirmImport}
                disabled={importing || preview.valid === 0}
                loading={importing}
              >
                <CheckCircle2 size={14} />
                <span>Add {preview.valid} address{preview.valid === 1 ? "" : "es"}</span>
              </DsButton>
              <DsButton variant="secondary" onClick={() => setPreview(null)} disabled={importing}>
                Cancel
              </DsButton>
            </div>
            {preview.valid === 0 && (
              <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--color-muted)" }}>
                Nothing to add from this file.
              </p>
            )}
          </div>
        )}

        {result && (
          <DsBanner
            tone="success"
            title={`Imported ${result.inserted} address${result.inserted === 1 ? "" : "es"}`}
            description={[
              `${result.skippedExisting} already suppressed`,
              `${result.skippedDuplicate} repeated in the file`,
              `${result.skippedInvalid} invalid`,
            ].join(" · ")}
          />
        )}
      </div>
    </div>
  );
}

/** Kept for the row action's warning icon usage. */
export const SuppressionWarningIcon = AlertTriangle;
