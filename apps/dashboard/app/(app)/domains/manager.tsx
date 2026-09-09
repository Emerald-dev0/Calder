"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { addDomain, checkDomainDns } from "../onboarding/actions";

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

export function DomainRow({
 domain,
}: {
 domain: { id: string; domain: string; status: string; verificationToken: string | null };
}) {
 const [state, setState] = React.useState(domain.status);
 const [detail, setDetail] = React.useState<string | null>(null);
 const [busy, setBusy] = React.useState(false);

 async function check() {
 setBusy(true);
 try {
 const r = await checkDomainDns(domain.id);
 setDetail(r.detail);
 if (r.verified) setState("verified");
 } finally {
 setBusy(false);
 }
 }

 return (
 <div style={{ padding: "14px 16px", fontSize: 14 }}>
 <div
 style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
 >
 <div>
 <b className="mono" style={{ fontSize: 13 }}>
 {domain.domain}
 </b>{" "}
 <span
 style={{
 fontSize: 12,
 fontWeight: 600,
 color: state === "verified" ? "#16A34A" : "#B45309",
 textTransform: "uppercase",
 letterSpacing: "0.06em",
 }}
 >
 {state}
 </span>
 </div>
 {state !== "verified" && (
 <button
 onClick={() => void check()}
 disabled={busy}
 style={{
 background: "none",
 border: "1px solid #E5E5E5",
 borderRadius: 8,
 padding: "6px 12px",
 fontSize: 13,
 cursor: "pointer",
 }}
 >
 Check DNS
 </button>
 )}
 </div>
 {state !== "verified" && domain.verificationToken && (
 <div className="mono" style={{ fontSize: 12, color: "#737373", marginTop: 8 }}>
 TXT _calder.{domain.domain} → calder_verify_{domain.verificationToken.slice(0, 12)}…
 </div>
 )}
 {detail && <p style={{ fontSize: 13, color: "#737373", margin: "8px 0 0" }}>{detail}</p>}
 </div>
 );
}
