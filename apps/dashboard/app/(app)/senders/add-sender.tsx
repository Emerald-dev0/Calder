"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDomainSender, createGmailSender } from "./actions";

const inputStyle = {
  width: "100%",
  height: 40,
  border: "1px solid #D4D4D4",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 14,
  background: "#fff",
  boxSizing: "border-box",
} as const;

const btnPrimary = {
  background: "#0B0C0E",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "0 18px",
  height: 42,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
} as const;

const optionStyle = (active: boolean) =>
  ({
    display: "block",
    width: "100%",
    textAlign: "left",
    border: active ? "2px solid #0B0C0E" : "1px solid #E5E5E5",
    background: active ? "#F5F4EF" : "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
  }) as const;

/**
 * Add-sender choice first, form second. Only working paths are offered:
 * verified domains and connected Gmail transports passed from the server.
 */
export function AddSender({
  projectId,
  verifiedDomains,
  gmailTransports,
}: {
  projectId: string;
  verifiedDomains: string[];
  gmailTransports: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<"gmail" | "domain" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [domain, setDomain] = useState(verifiedDomains[0] ?? "");
  const [transportId, setTransportId] = useState(gmailTransports[0]?.id ?? "");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res =
        choice === "domain"
          ? await createDomainSender({ projectId, displayName, localPart, domain })
          : await createGmailSender({ projectId, transportId, displayName });
      router.push(`/senders/${res.id}?project=${projectId}`);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Add sender</p>
      <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <button
          type="button"
          onClick={() => setChoice(choice === "gmail" ? null : "gmail")}
          style={optionStyle(choice === "gmail")}
          aria-pressed={choice === "gmail"}
        >
          <b style={{ fontSize: 14 }}>Connect Gmail</b>
          <span style={{ display: "block", fontSize: 13, color: "#737373", marginTop: 2 }}>
            Use an existing Gmail account. No domain needed.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setChoice(choice === "domain" ? null : "domain")}
          style={optionStyle(choice === "domain")}
          aria-pressed={choice === "domain"}
        >
          <b style={{ fontSize: 14 }}>Verify a domain</b>
          <span style={{ display: "block", fontSize: 13, color: "#737373", marginTop: 2 }}>
            Send from your own domain, best for production.
          </span>
        </button>
      </div>

      {choice === "gmail" && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            padding: 16,
            marginTop: 12,
            maxWidth: 520,
          }}
        >
          {gmailTransports.length === 0 ? (
            <p style={{ fontSize: 13, color: "#737373", margin: 0 }}>
              No Gmail connected to this project yet. Connect it during onboarding or in project
              settings first.
            </p>
          ) : (
            <>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Gmail account
              </label>
              <select
                value={transportId}
                onChange={(e) => setTransportId(e.target.value)}
                style={{ ...inputStyle, marginBottom: 10 }}
              >
                {gmailTransports.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Display name
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Daniel"
                style={{ ...inputStyle, marginBottom: 12 }}
              />
              <button type="button" onClick={submit} disabled={busy} style={btnPrimary}>
                {busy ? "Creating…" : "Create Gmail sender"}
              </button>
            </>
          )}
          {msg && !msg.ok && (
            <p style={{ fontSize: 12, color: "#DC2626", margin: "8px 0 0" }}>{msg.text}</p>
          )}
        </div>
      )}

      {choice === "domain" && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            padding: 16,
            marginTop: 12,
            maxWidth: 520,
          }}
        >
          {verifiedDomains.length === 0 ? (
            <p style={{ fontSize: 13, color: "#737373", margin: 0 }}>
              No verified domains on this project yet.{" "}
              <a href={`/domains?project=${projectId}`} style={{ color: "#0B0C0E" }}>
                Verify a domain first
              </a>
              , then create senders on it.
            </p>
          ) : (
            <>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Display name
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Calder Support"
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Email address
              </label>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  value={localPart}
                  onChange={(e) => setLocalPart(e.target.value)}
                  placeholder="support"
                  aria-label="Local part"
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                />
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  aria-label="Domain"
                  style={{ ...inputStyle, width: "auto" }}
                >
                  {verifiedDomains.map((d) => (
                    <option key={d} value={d}>
                      @{d}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mono" style={{ fontSize: 12, color: "#525252", margin: "0 0 12px" }}>
                Preview: {displayName || "Name"} &lt;{localPart || "name"}@{domain}&gt;
              </p>
              <button type="button" onClick={submit} disabled={busy} style={btnPrimary}>
                {busy ? "Creating…" : "Create sender"}
              </button>
            </>
          )}
          {msg && !msg.ok && (
            <p style={{ fontSize: 12, color: "#DC2626", margin: "8px 0 0" }}>{msg.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
