"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldBan, Trash2 } from "lucide-react";
import { addSuppression, removeSuppression } from "./actions";
import {
  StatusPill,
  RelativeTime,
  DsBanner,
} from "../../../components/design-system";

const REASONS = ["manual", "bounce", "complaint"];

export function SuppressionManager({
  projectId,
  rows,
}: {
  projectId: string;
  rows: { id: string; email: string; reason: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("manual");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addSuppression(projectId, email, reason);
      setEmail("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add suppression.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await removeSuppression(projectId, id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Add Address to Suppression List</h2>
            <p className="ds-card-subtitle">
              Hard bounces and ISP spam complaints block automatically. You can also block recipients manually below.
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="block@this-address.com"
              className="ds-input mono"
              style={{ flex: 1, minWidth: 220 }}
            />
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ds-select"
              style={{ width: "auto", minWidth: 150 }}
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !email}
              className="ds-btn ds-btn-primary"
            >
              <ShieldBan size={14} />
              <span>Block address</span>
            </button>
          </div>
          {error && (
            <div style={{ marginTop: 12 }}>
              <DsBanner tone="danger" title="Could not add suppression" description={error} />
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="ds-table-shell">
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Suppressed Address</th>
                  <th style={{ width: 150 }}>Reason</th>
                  <th style={{ width: 140 }}>Blocked</th>
                  <th style={{ width: 120, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b className="mono" style={{ fontSize: 13 }}>
                        {r.email}
                      </b>
                    </td>
                    <td>
                      <StatusPill status={r.reason} label={r.reason} />
                    </td>
                    <td>
                      <RelativeTime value={r.createdAt} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => void remove(r.id)}
                        disabled={busy}
                        className="ds-btn ds-btn-secondary ds-btn-sm"
                      >
                        <Trash2 size={12} />
                        <span>Unblock</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
