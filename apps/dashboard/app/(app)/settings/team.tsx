"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { inviteMember, updateMemberRole, removeMember, revokeInvite } from "./actions";

type Role = "owner" | "admin" | "member";

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

const btnDanger: React.CSSProperties = {
 background: "none",
 border: "1px solid #E5E5E5",
 borderRadius: 8,
 padding: "6px 12px",
 fontSize: 13,
 color: "#DC2626",
 cursor: "pointer",
};

export function InviteForm({ orgId, canManage }: { orgId: string; canManage: boolean }) {
 const router = useRouter();
 const [email, setEmail] = React.useState("");
 const [role, setRole] = React.useState<"admin" | "member">("member");
 const [link, setLink] = React.useState<string | null>(null);
 const [error, setError] = React.useState<string | null>(null);
 const [busy, setBusy] = React.useState(false);
 if (!canManage) return null;

 async function send() {
 setBusy(true);
 setError(null);
 try {
 const r = await inviteMember(orgId, email, role);
 setLink(r.inviteLink);
 setEmail("");
 router.refresh();
 } catch (e) {
 setError(e instanceof Error ? e.message : "Could not invite.");
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
 <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Invite a teammate</p>
 <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
 <input
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 placeholder="teammate@example.com"
 type="email"
 style={{
 height: 44,
 border: "1px solid #D4D4D4",
 borderRadius: 10,
 padding: "0 14px",
 fontSize: 14,
 flex: 1,
 minWidth: 200,
 }}
 />
 <select
 value={role}
 onChange={(e) => setRole(e.target.value as "admin" | "member")}
 style={{
 height: 44,
 border: "1px solid #D4D4D4",
 borderRadius: 10,
 padding: "0 14px",
 fontSize: 14,
 }}
 >
 <option value="member">member</option>
 <option value="admin">admin</option>
 </select>
 <button onClick={() => void send()} disabled={busy} style={btnPrimary}>
 Invite
 </button>
 </div>
 {link && (
 <div
 style={{
 marginTop: 14,
 background: "#0B0C0E",
 color: "#fff",
 borderRadius: 10,
 padding: "14px 16px",
 fontFamily: "monospace",
 fontSize: 13,
 wordBreak: "break-all",
 }}
 >
 {link}
 <span
 style={{
 display: "block",
 fontSize: 12,
 color: "#B5B5B5",
 marginTop: 6,
 fontFamily: "sans-serif",
 }}
 >
 Share this link, it expires in 7 days and they join on sign-in.
 </span>
 </div>
 )}
 {error && (
 <p role="alert" style={{ color: "#DC2626", fontSize: 14 }}>
 {error}
 </p>
 )}
 </div>
 );
}

interface Member {
 id: string;
 userId: string;
 email: string;
 name: string | null;
 role: string;
 createdAt: string;
}

export function MemberRow({
 orgId,
 member,
 isSelf,
 canAdminister,
}: {
 orgId: string;
 member: Member;
 isSelf: boolean;
 canAdminister: boolean;
}) {
 const router = useRouter();
 const [error, setError] = React.useState<string | null>(null);

 async function act(fn: () => Promise<unknown>) {
 setError(null);
 try {
 await fn();
 router.refresh();
 } catch (e) {
 setError(e instanceof Error ? e.message : "Action failed.");
 }
 }

 return (
 <div>
 <div
 style={{
 display: "flex",
 justifyContent: "space-between",
 alignItems: "center",
 gap: 12,
 padding: "12px 16px",
 fontSize: 14,
 }}
 >
 <div>
 <b>{member.name ?? member.email}</b>{" "}
 <span style={{ color: "#737373", fontSize: 13 }}>{member.email}</span>{" "}
 <span
 className="mono"
 style={{
 fontSize: 11,
 textTransform: "uppercase",
 letterSpacing: "0.06em",
 color: "#737373",
 }}
 >
 {member.role}
 </span>
 {isSelf && <span style={{ fontSize: 12, color: "#737373" }}> (you)</span>}
 </div>
 {canAdminister && !isSelf && (
 <div style={{ display: "flex", gap: 8 }}>
 <select
 value={member.role}
 onChange={(e) =>
 void act(() => updateMemberRole(orgId, member.id, e.target.value as Role))
 }
 style={{ height: 36, border: "1px solid #E5E5E5", borderRadius: 8, fontSize: 13 }}
 aria-label={`Role for ${member.email}`}
 >
 <option value="member">member</option>
 <option value="admin">admin</option>
 <option value="owner">owner</option>
 </select>
 <button
 onClick={() => void act(() => removeMember(orgId, member.id))}
 style={btnDanger}
 >
 Remove
 </button>
 </div>
 )}
 </div>
 {error && (
 <p role="alert" style={{ color: "#DC2626", fontSize: 13, margin: "0 16px 12px" }}>
 {error}
 </p>
 )}
 </div>
 );
}

export function RevokeInviteButton({ orgId, inviteId }: { orgId: string; inviteId: string }) {
 const router = useRouter();
 const [done, setDone] = React.useState(false);
 if (done) return <span style={{ fontSize: 13, color: "#737373" }}>revoked</span>;
 return (
 <button
 onClick={async () => {
 await revokeInvite(orgId, inviteId);
 setDone(true);
 router.refresh();
 }}
 style={btnDanger}
 >
 Revoke
 </button>
 );
}
