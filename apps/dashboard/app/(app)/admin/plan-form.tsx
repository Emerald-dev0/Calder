"use client";

import { useState } from "react";
import { setSubscription } from "./actions";

const TIERS = ["free", "starter", "pro", "scale"] as const;

export function PlanForm({ orgId, currentPlan }: { orgId: string; currentPlan: string | null }) {
 const [tier, setTier] = useState<string>(currentPlan ?? "starter");
 const [months, setMonths] = useState("1");
 const [msg, setMsg] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);

 return (
 <form
 onSubmit={async (e) => {
 e.preventDefault();
 setBusy(true);
 setMsg(null);
 const res = await setSubscription(orgId, tier, Number(months));
 setMsg(res.ok ? `Plan set to ${tier}.` : (res.error ?? "Failed."));
 setBusy(false);
 }}
 style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
 >
 <select
 value={tier}
 onChange={(e) => setTier(e.target.value)}
 aria-label="Plan tier"
 style={{ fontSize: 13, padding: "6px 8px", borderRadius: 8, border: "1px solid #E5E5E5" }}
 >
 {TIERS.map((t) => (
 <option key={t} value={t}>
 {t}
 </option>
 ))}
 </select>
 <input
 value={months}
 onChange={(e) => setMonths(e.target.value)}
 aria-label="Duration in months"
 type="number"
 min={1}
 max={36}
 style={{
 fontSize: 13,
 padding: "6px 8px",
 borderRadius: 8,
 border: "1px solid #E5E5E5",
 width: 72,
 }}
 />
 <span style={{ fontSize: 12, color: "#737373" }}>months</span>
 <button
 type="submit"
 disabled={busy}
 style={{
 fontSize: 13,
 padding: "6px 12px",
 borderRadius: 8,
 border: "1px solid #111",
 background: "#111",
 color: "#fff",
 cursor: busy ? "wait" : "pointer",
 }}
 >
 {busy ? "Saving" : "Set plan"}
 </button>
 {msg && <span style={{ fontSize: 12, color: msg.startsWith("Plan") ? "#16A34A" : "#DC2626" }}>{msg}</span>}
 </form>
 );
}
