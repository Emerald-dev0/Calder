"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, Plus, RefreshCw, ShieldCheck, KeyRound } from "lucide-react";
import {
  addDomain,
  checkDomainDns,
  regenerateDomainToken,
  linkDomainToSes,
  refreshDomainSesStatus,
} from "../onboarding/actions";
import { StatusPill, CopyField, DsBanner } from "../../../components/design-system";

export function DomainAdder({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [domain, setDomain] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addDomain(projectId, domain);
      setDomain("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add domain.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Add Sending Domain</h2>
          <p className="ds-card-subtitle">
            Register a root domain or dedicated subdomain (e.g. <code className="mono">notify.acme.com</code>) to generate 2048-bit RSA DKIM keys.
          </p>
        </div>
      </div>
      <div className="ds-card-body">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="mail.acme.com"
            className="ds-input mono"
            style={{ flex: 1, minWidth: 240 }}
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !domain.trim()}
            className="ds-btn ds-btn-primary"
          >
            <Plus size={14} />
            <span>{busy ? "Adding…" : "Add domain"}</span>
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12 }}>
            <DsBanner tone="danger" title="Could not add domain" description={error} />
          </div>
        )}
      </div>
    </div>
  );
}

interface ChallengeInfo {
  host: string;
  value: string;
  expiresAt: string | null;
}

function DnsRecordRow({
  type,
  host,
  value,
  purpose,
}: {
  type: string;
  host: string;
  value: string;
  purpose: string;
}) {
  return (
    <tr>
      <td style={{ width: 90 }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 5,
            background: "var(--color-surface-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          {type}
        </span>
      </td>
      <td style={{ width: 130, fontSize: 12, color: "var(--color-muted)" }}>{purpose}</td>
      <td>
        <CopyField value={host} compact />
      </td>
      <td>
        <CopyField value={value} compact />
      </td>
    </tr>
  );
}

export function DomainRow({
  domain,
}: {
  domain: {
    id: string;
    domain: string;
    status: string;
    verification: ChallengeInfo | null;
    dkimRecords: { name: string; type: string; value: string }[];
    dkimStatus: string | null;
    sesIdentityStatus: string | null;
    lastVerifyError: string | null;
  };
}) {
  const router = useRouter();
  const [state, setState] = React.useState(domain.status);
  const [challenge, setChallenge] = React.useState<ChallengeInfo | null>(domain.verification);
  const [detail, setDetail] = React.useState<string | null>(domain.lastVerifyError);
  const [dkim, setDkim] = React.useState(domain.dkimRecords ?? []);
  const [dkimStatus, setDkimStatus] = React.useState(domain.dkimStatus);
  const [spf] = React.useState(
    domain.sesIdentityStatus && domain.sesIdentityStatus !== "not_linked"
      ? { name: domain.domain, type: "TXT", value: "v=spf1 include:amazonses.com ~all" }
      : null,
  );
  const [busy, setBusy] = React.useState(false);

  async function check() {
    setBusy(true);
    try {
      const r = await checkDomainDns(domain.id);
      setDetail(r.detail);
      if (r.verified) {
        setState("verified");
        router.refresh();
      }
    } catch (e) {
      setDetail(e instanceof Error ? e.message : "Check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const r = await regenerateDomainToken(domain.id);
      setChallenge({ host: r.host, value: r.value, expiresAt: r.expiresAt });
      setState("pending");
      setDetail("Fresh token minted — publish the new TXT, then check again.");
      router.refresh();
    } catch (e) {
      setDetail(e instanceof Error ? e.message : "Could not regenerate.");
    } finally {
      setBusy(false);
    }
  }

  async function linkSes() {
    setBusy(true);
    try {
      const r = await linkDomainToSes(domain.id);
      setDkim(r.records);
      setDkimStatus(r.dkimStatus);
      router.refresh();
    } catch (e) {
      setDetail(e instanceof Error ? e.message : "SES link failed.");
    } finally {
      setBusy(false);
    }
  }

  async function pollDkim() {
    setBusy(true);
    try {
      const r = await refreshDomainSesStatus(domain.id);
      setDkimStatus(r.dkimStatus);
      if (r.identityStatus === "verified") router.refresh();
    } catch (e) {
      setDetail(e instanceof Error ? e.message : "SES poll failed.");
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    if (dkim.length === 0 || dkimStatus === "SUCCESS") return;
    const id = setInterval(() => void pollDkim(), 20_000);
    return () => clearInterval(id);
  }, [dkim.length, dkimStatus]);

  return (
    <div className="ds-card" style={{ marginBottom: 16 }}>
      <div className="ds-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Globe size={16} style={{ color: "var(--color-accent)" }} />
          <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
            {domain.domain}
          </span>
          <StatusPill status={state} />
          {dkim.length > 0 && (
            <StatusPill
              status={dkimStatus === "SUCCESS" ? "verified" : "pending"}
              label={dkimStatus === "SUCCESS" ? "DKIM Verified" : `DKIM ${dkimStatus ?? "PENDING"}`}
            />
          )}
        </div>
      </div>

      <div className="ds-card-body">
        {/* Step 1 — ownership */}
        {state !== "verified" && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>
              Step 1 · Verify DNS Ownership for <span className="mono">{domain.domain}</span>
            </div>
            {state === "expired" ? (
              <>
                <p style={{ fontSize: 13, color: "var(--color-warning)", margin: "0 0 10px" }}>
                  The challenge expired after 72 hours. Mint a fresh token and publish it.
                </p>
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={busy}
                  className="ds-btn ds-btn-secondary ds-btn-sm"
                >
                  <KeyRound size={13} />
                  <span>Mint new token</span>
                </button>
              </>
            ) : challenge ? (
              <>
                <div className="ds-table-scroll" style={{ marginBottom: 10 }}>
                  <table className="ds-table is-compact">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Purpose</th>
                        <th>Host / Name</th>
                        <th>Value / Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      <DnsRecordRow
                        type="TXT"
                        purpose="Ownership"
                        host={challenge.host}
                        value={challenge.value}
                      />
                    </tbody>
                  </table>
                </div>
                {challenge.expiresAt && (
                  <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "6px 0 10px" }}>
                    Expires{" "}
                    {new Date(challenge.expiresAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                    . DNS propagation typically completes within 5–15 minutes.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void check()}
                    disabled={busy}
                    className="ds-btn ds-btn-primary ds-btn-sm"
                  >
                    <RefreshCw size={13} />
                    <span>Check DNS records</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    disabled={busy}
                    className="ds-btn ds-btn-secondary ds-btn-sm"
                  >
                    <span>Mint new token</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 10px" }}>
                  No live challenge token active. Mint a new token to verify DNS ownership.
                </p>
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={busy}
                  className="ds-btn ds-btn-secondary ds-btn-sm"
                >
                  <span>Mint new token</span>
                </button>
              </>
            )}
            {detail && (
              <div style={{ marginTop: 10 }}>
                <DsBanner tone="danger" title="DNS verification diagnostic" description={detail} />
              </div>
            )}
          </div>
        )}

        {/* Step 2 — DKIM/SPF */}
        {state === "verified" && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={15} style={{ color: "var(--color-success)" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                  Step 2 · Cryptographic DKIM & SPF Records for{" "}
                  <span className="mono">{domain.domain}</span>
                </span>
              </div>
              {dkim.length > 0 && (
                <button
                  type="button"
                  onClick={() => void pollDkim()}
                  disabled={busy}
                  className="ds-btn ds-btn-secondary ds-btn-sm"
                >
                  <RefreshCw size={13} />
                  <span>
                    {dkimStatus === "SUCCESS" ? "Recheck status" : "Check propagation"}
                  </span>
                </button>
              )}
            </div>

            {dkim.length === 0 ? (
              <>
                <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 10px" }}>
                  Link this domain to AWS SES to provision its 3 DKIM CNAME selectors.
                </p>
                <button
                  type="button"
                  onClick={() => void linkSes()}
                  disabled={busy}
                  className="ds-btn ds-btn-primary ds-btn-sm"
                >
                  <span>Generate DKIM records</span>
                </button>
              </>
            ) : (
              <>
                <div className="ds-table-scroll" style={{ marginBottom: 10 }}>
                  <table className="ds-table is-compact">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Purpose</th>
                        <th>Host / Name</th>
                        <th>Value / Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dkim.map((r, idx) => (
                        <DnsRecordRow
                          key={r.name}
                          type={r.type}
                          purpose={`DKIM #${idx + 1}`}
                          host={r.name}
                          value={r.value}
                        />
                      ))}
                      {spf && (
                        <DnsRecordRow
                          type={spf.type}
                          purpose="SPF Alignment"
                          host={spf.name}
                          value={spf.value}
                        />
                      )}
                      <DnsRecordRow
                        type="TXT"
                        purpose="DMARC Policy"
                        host={`_dmarc.${domain.domain}`}
                        value="v=DMARC1; p=none; pct=100; adkim=s; aspf=s"
                      />
                    </tbody>
                  </table>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color:
                      dkimStatus === "SUCCESS"
                        ? "var(--color-success)"
                        : "var(--color-muted)",
                  }}
                >
                  {dkimStatus === "SUCCESS"
                    ? "✓ DKIM verified — branded cryptographic signing is active."
                    : `SES status: ${dkimStatus ?? "PENDING"}. CNAME records propagate within minutes. Polling automatically every 20s.`}
                </span>
              </>
            )}
            {detail && (
              <div style={{ marginTop: 10 }}>
                <DsBanner tone="danger" title="SES diagnostic" description={detail} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
