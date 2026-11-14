"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Inbox, Plus, RefreshCw, Trash2 } from "lucide-react";
import { addReceivingDomain, disableReceivingDomain, verifyReceivingDomain } from "./actions";
import {
  DsBanner,
  DsButton,
  DsInput,
  CopyField,
  StatusPill,
} from "../../../components/design-system";

/**
 * Receiving-domain UI.
 *
 * The one thing this screen must never do is encourage someone to point their
 * existing mailbox at us. The MX warning is not a footnote — it is rendered with
 * the record, and a domain whose MX already belongs to another provider fails
 * verification with an explanation rather than a generic "pending".
 */

interface DnsRecord {
  type: string;
  host: string;
  value: string;
  purpose: string;
  warning?: string;
}

export function ReceivingDomainAdder({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [domain, setDomain] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [records, setRecords] = React.useState<DnsRecord[] | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const result = await addReceivingDomain(projectId, domain);
      setRecords(result.records);
      setDomain("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the domain.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Add a receiving domain</h2>
          <p className="ds-card-subtitle">
            Mail sent to <code className="mono">anything@this-domain</code> is accepted by Calder
            and stored for your workspace. Use a dedicated subdomain such as{" "}
            <code className="mono">inbox.acme.com</code>.
          </p>
        </div>
      </div>
      <div className="ds-card-body">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <DsInput
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="inbox.acme.com"
            aria-label="Receiving domain"
            style={{ flex: "1 1 260px" }}
            disabled={busy}
          />
          <DsButton
            onClick={add}
            disabled={busy || domain.trim().length === 0}
            icon={<Plus size={14} />}
          >
            {busy ? "Adding…" : "Add domain"}
          </DsButton>
        </div>

        {error && (
          <div style={{ marginTop: 12 }}>
            <DsBanner tone="danger" title="That domain was not added" description={error} />
          </div>
        )}

        {records && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <DsBanner
              tone="warning"
              title="Check your existing MX before touching DNS"
              description={
                <>
                  If <code className="mono">{records.find((r) => r.type === "MX")?.host}</code>{" "}
                  already receives mail (Google Workspace, Microsoft 365, Zoho…), do not add our MX
                  record to it. Point a subdomain at us instead — your existing mail keeps arriving
                  where it does today.
                </>
              }
            />
            {records.map((record) => (
              <div
                key={`${record.type}-${record.host}`}
                className="ds-card"
                style={{ padding: 14 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <StatusPill
                    status={record.type === "MX" ? "info" : "pending"}
                    label={record.type}
                  />
                  <code className="mono" style={{ fontSize: 12 }}>
                    {record.host}
                  </code>
                </div>
                <CopyField value={record.value} label="Value" compact />
                <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.75 }}>{record.purpose}</p>
                {record.warning && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-warning)" }}>
                    {record.warning}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReceivingDomainRow({
  id,
  domain,
  status,
  mxHost,
  lastError,
  provisioned,
  accepting,
}: {
  id: string;
  domain: string;
  status: string;
  mxHost: string;
  lastError: string | null;
  provisioned: boolean;
  accepting: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "verify" | "disable">(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function verify() {
    setBusy("verify");
    setMessage(null);
    try {
      const result = await verifyReceivingDomain(id);
      setMessage({ ok: result.ok, text: result.message });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Check failed." });
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!window.confirm(`Stop receiving mail for ${domain}? Already received messages are kept.`)) {
      return;
    }
    setBusy("disable");
    try {
      await disableReceivingDomain(id);
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not disable." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ds-card" style={{ padding: 16, marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Inbox size={15} />
            <strong className="mono" style={{ fontSize: 13 }}>
              {domain}
            </strong>
            <StatusPill status={status} />
            {status === "verified" && (
              <StatusPill
                status={accepting ? "active" : "pending"}
                label={accepting ? "accepting mail" : "AWS rule not recorded"}
              />
            )}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.75 }}>
            MX → <code className="mono">{mxHost}</code> ·{" "}
            {provisioned ? "SES receipt rule recorded" : "no SES receipt rule recorded yet"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <DsButton
            variant="secondary"
            onClick={verify}
            disabled={busy !== null || status === "disabled"}
            icon={<RefreshCw size={13} />}
          >
            {busy === "verify" ? "Checking…" : "Check DNS"}
          </DsButton>
          <DsButton
            variant="ghost"
            onClick={disable}
            disabled={busy !== null || status === "disabled"}
            icon={<Trash2 size={13} />}
          >
            Disable
          </DsButton>
        </div>
      </div>

      {message && (
        <div style={{ marginTop: 12 }}>
          <DsBanner
            tone={message.ok ? "success" : "warning"}
            title={message.ok ? "Check passed" : "Not ready yet"}
            description={message.text}
          />
        </div>
      )}
      {!message && lastError && (
        <div style={{ marginTop: 12 }}>
          <DsBanner tone="warning" title="Last check did not pass" description={lastError} />
        </div>
      )}
    </div>
  );
}
