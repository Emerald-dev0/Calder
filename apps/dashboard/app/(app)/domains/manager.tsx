"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  addDomain,
  checkDomainDns,
  regenerateDomainToken,
  linkDomainToSes,
  refreshDomainSesStatus,
} from "../onboarding/actions";

const btnPrimary: React.CSSProperties = {
  background: "#0B0C0E",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  height: 44,
  padding: "0 22px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  background: "none",
  border: "1px solid #E5E5E5",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};

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
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E5E5",
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Add domain</p>
      <div style={{ display: "flex", gap: 10 }}>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="acme.com"
          style={{
            height: 44,
            border: "1px solid #D4D4D4",
            borderRadius: 10,
            padding: "0 14px",
            fontSize: 14,
            flex: 1,
          }}
        />
        <button onClick={() => void add()} disabled={busy} style={btnPrimary}>
          Add
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: "#DC2626", fontSize: 14 }}>
          {error}
        </p>
      )}
    </div>
  );
}

interface ChallengeInfo {
  host: string;
  value: string;
  expiresAt: string | null;
}

function RecordCard({ h, t, v }: { h: string; t: string; v: string }) {
  return (
    <div
      className="mono"
      style={{
        background: "#F7F6F3",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        marginTop: 6,
        wordBreak: "break-all",
      }}
    >
      <b>{t}</b> {h} <span style={{ color: "#737373" }}>→</span> {v}
    </div>
  );
}

/**
 * M4.2 setup wizard: Step 1 = DNS ownership challenge (live check),
 * Step 2 = SES/DKIM records + propagation polling.
 * Failure diagnostics spell out expected vs found and the exact fix.
 */
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
      : null
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

  // Live polling while DKIM is pending.
  React.useEffect(() => {
    if (dkim.length === 0 || dkimStatus === "SUCCESS") return;
    const id = setInterval(() => void pollDkim(), 20_000);
    return () => clearInterval(id);
  }, [dkim.length, dkimStatus]);

  const tone = {
    verified: "#16A34A",
    expired: "#B45309",
    failed: "#DC2626",
    pending: "#B45309",
  }[state] ?? "#B45309";

  return (
    <div style={{ padding: "14px 16px", fontSize: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <b className="mono" style={{ fontSize: 13 }}>
            {domain.domain}
          </b>{" "}
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: tone,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {state}
          </span>
          {dkim.length > 0 && (
            <span style={{ fontSize: 12, color: "#737373", marginLeft: 10 }}>
              DKIM {dkimStatus === "SUCCESS" ? "✓ live" : `… ${dkimStatus ?? "PENDING"}`}
            </span>
          )}
        </div>
      </div>

      {/* Step 1 — ownership */}
      {state !== "verified" && (
        <div
          style={{
            marginTop: 10,
            border: "1px solid #EFEEF9",
            borderRadius: 10,
            padding: 12,
            background: "#FBFBFD",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>
            Step 1 · Prove you own {domain.domain}
          </p>
          {state === "expired" ? (
            <>
              <p style={{ fontSize: 13, color: "#B45309", margin: "0 0 8px" }}>
                The challenge expired after 72 hours. Mint a fresh token and publish it.
              </p>
              <button onClick={() => void regenerate()} disabled={busy} style={btnGhost}>
                Mint new token
              </button>
            </>
          ) : challenge ? (
            <>
              <RecordCard h={challenge.host} t="TXT" v={challenge.value} />
              {challenge.expiresAt && (
                <p style={{ fontSize: 12, color: "#737373", margin: "6px 0 0" }}>
                  Expires {new Date(challenge.expiresAt).toLocaleDateString(
                    "en-GB", { day: "numeric", month: "short" })}
                  . Propagation can take minutes; check as often as you like (10/hr).
                </p>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={() => void check()} disabled={busy} style={btnGhost}>
                  Check DNS
                </button>
                <button onClick={() => void regenerate()} disabled={busy} style={btnGhost}>
                  Mint new token
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "#737373", margin: "0 0 8px" }}>
                No live challenge (legacy token). Mint a new one to verify.
              </p>
              <button onClick={() => void regenerate()} disabled={busy} style={btnGhost}>
                Mint new token
              </button>
            </>
          )}
          {detail && (
            <p style={{ fontSize: 13, color: "#B91C1C", margin: "8px 0 0" }}>{detail}</p>
          )}
        </div>
      )}

      {/* Step 2 — DKIM/SPF */}
      {state === "verified" && (
        <div
          style={{
            marginTop: 10,
            border: "1px solid #EFEEF9",
            borderRadius: 10,
            padding: 12,
            background: "#FBFBFD",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px" }}>
            Step 2 · Sign as {domain.domain} (DKIM)
          </p>
          {dkim.length === 0 ? (
            <>
              <p style={{ fontSize: 13, color: "#737373", margin: "0 0 8px" }}>
                Link the domain to SES to get its DKIM CNAME set. Unbranded sending continues
                to work; branded signing starts once DKIM is live.
              </p>
              <button onClick={() => void linkSes()} disabled={busy} style={btnGhost}>
                Generate DKIM records
              </button>
            </>
          ) : (
            <>
              {dkim.map((r) => (
                <RecordCard key={r.name} h={r.name} t={r.type} v={r.value} />
              ))}
              {spf && <RecordCard h={spf.name} t={spf.type} v={spf.value} />}
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                <button onClick={() => void pollDkim()} disabled={busy} style={btnGhost}>
                  {dkimStatus === "SUCCESS" ? "Recheck status" : "Check propagation"}
                </button>
                <span style={{ fontSize: 12, color: dkimStatus === "SUCCESS" ? "#16A34A" : "#737373" }}>
                  {dkimStatus === "SUCCESS"
                    ? "DKIM verified — branded signing live."
                    : `SES sees: ${dkimStatus ?? "PENDING"}. CNAMEs usually publish in minutes, worst case hours. Polling automatically every 20s.`}
                </span>
              </div>
            </>
          )}
          {detail && (
            <p style={{ fontSize: 13, color: "#B91C1C", margin: "8px 0 0" }}>{detail}</p>
          )}
        </div>
      )}
    </div>
  );
}
