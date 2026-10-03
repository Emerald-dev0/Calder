"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Mail, Plus } from "lucide-react";
import { createDomainSender, createGmailSender } from "./actions";
import { DsBanner, StatusPill } from "../../../components/design-system";

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
  const [choice, setChoice] = useState<"gmail" | "domain" | null>("domain");
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
    <div className="ds-card" style={{ marginTop: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Add Sender Identity</h2>
          <p className="ds-card-subtitle">
            Register a verified From address backed by your custom domain or connected Gmail on-ramp.
          </p>
        </div>
      </div>

      <div className="ds-card-body">
        <div className="ds-grid-2" style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setChoice(choice === "domain" ? null : "domain")}
            aria-pressed={choice === "domain"}
            style={{
              textAlign: "left",
              padding: 16,
              borderRadius: "var(--radius-lg)",
              border: `1px solid ${
                choice === "domain" ? "var(--color-ink)" : "var(--color-border-strong)"
              }`,
              boxShadow:
                choice === "domain" ? "inset 0 0 0 1px var(--color-ink)" : "none",
              background:
                choice === "domain"
                  ? "var(--color-surface-elevated)"
                  : "var(--color-surface)",
              color: "var(--color-ink)",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <Globe size={16} style={{ color: "var(--color-accent)" }} />
                <span>Verify a Custom Domain</span>
              </span>
              <StatusPill status="verified" label="Production" />
            </div>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--color-muted)" }}>
              Send from your own domain with full DKIM, SPF, and DMARC alignment via AWS SES.
            </span>
          </button>

          <button
            type="button"
            onClick={() => setChoice(choice === "gmail" ? null : "gmail")}
            aria-pressed={choice === "gmail"}
            style={{
              textAlign: "left",
              padding: 16,
              borderRadius: "var(--radius-lg)",
              border: `1px solid ${
                choice === "gmail" ? "var(--color-ink)" : "var(--color-border-strong)"
              }`,
              boxShadow:
                choice === "gmail" ? "inset 0 0 0 1px var(--color-ink)" : "none",
              background:
                choice === "gmail"
                  ? "var(--color-surface-elevated)"
                  : "var(--color-surface)",
              color: "var(--color-ink)",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>
                <Mail size={16} style={{ color: "var(--color-muted)" }} />
                <span>Connect Gmail On-Ramp</span>
              </span>
              <StatusPill status="test" label="Prototype" />
            </div>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--color-muted)" }}>
              Use an existing personal Gmail account for early testing. No DNS records needed.
            </span>
          </button>
        </div>

        {choice === "gmail" && (
          <div
            style={{
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: 16,
            }}
          >
            {gmailTransports.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
                No Gmail account connected to this project yet. Connect it during onboarding or in{" "}
                <a href="/integrations" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
                  Integrations
                </a>{" "}
                first.
              </p>
            ) : (
              <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                    Gmail account
                  </label>
                  <select
                    value={transportId}
                    onChange={(e) => setTransportId(e.target.value)}
                    className="ds-select"
                  >
                    {gmailTransports.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                    Display name
                  </label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ada Lovelace"
                    className="ds-input"
                  />
                </div>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="ds-btn ds-btn-primary"
                >
                  <Plus size={14} />
                  <span>{busy ? "Creating…" : "Create Gmail sender"}</span>
                </button>
              </div>
            )}
            {msg && !msg.ok && (
              <div style={{ marginTop: 10 }}>
                <DsBanner tone="danger" title="Could not create sender" description={msg.text} />
              </div>
            )}
          </div>
        )}

        {choice === "domain" && (
          <div
            style={{
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: 16,
            }}
          >
            {verifiedDomains.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
                No verified domains on this project yet.{" "}
                <a
                  href={`/domains?project=${projectId}`}
                  style={{ color: "var(--color-accent)", fontWeight: 600 }}
                >
                  Verify a domain first →
                </a>
                , then create sender identities on it.
              </p>
            ) : (
              <div style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                    Display name
                  </label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Calder Support"
                    className="ds-input"
                  />
                </div>
                <div>
                  <label className="ds-label" style={{ display: "block", marginBottom: 6 }}>
                    Email address
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={localPart}
                      onChange={(e) => setLocalPart(e.target.value)}
                      placeholder="support"
                      aria-label="Local part"
                      className="ds-input mono"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      aria-label="Domain"
                      className="ds-select mono"
                      style={{ width: "auto" }}
                    >
                      {verifiedDomains.map((d) => (
                        <option key={d} value={d}>
                          @{d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mono" style={{ fontSize: 12, color: "var(--color-muted)", margin: 0 }}>
                  Preview: {displayName || "Name"} &lt;{localPart || "name"}@{domain}&gt;
                </p>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="ds-btn ds-btn-primary"
                >
                  <Plus size={14} />
                  <span>{busy ? "Creating…" : "Create sender identity"}</span>
                </button>
              </div>
            )}
            {msg && !msg.ok && (
              <div style={{ marginTop: 10 }}>
                <DsBanner tone="danger" title="Could not create sender" description={msg.text} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
