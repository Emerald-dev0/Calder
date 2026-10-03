"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2 } from "lucide-react";
import { inviteMember, updateMemberRole, removeMember, revokeInvite } from "./actions";
import {
  Avatar,
  CopyField,
  DsBanner,
  StatusPill,
  ConfirmDialog,
} from "../../../components/design-system";

type Role = "owner" | "admin" | "member";

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
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Invite a Teammate</h2>
          <p className="ds-card-subtitle">
            Generate a 7-day signed invitation link for an engineer or operator.
          </p>
        </div>
      </div>
      <div className="ds-card-body">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            type="email"
            className="ds-input"
            style={{ flex: 1, minWidth: 220 }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="ds-select"
            style={{ width: "auto", minWidth: 140 }}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !email.trim()}
            className="ds-btn ds-btn-primary"
          >
            <UserPlus size={14} />
            <span>{busy ? "Inviting…" : "Invite"}</span>
          </button>
        </div>
        {link && (
          <div style={{ marginTop: 14 }}>
            <DsBanner
              tone="info"
              title="Share this invitation link (expires in 7 days)"
              description={
                <div style={{ marginTop: 8 }}>
                  <CopyField label="Invite URL" value={link} />
                </div>
              }
            />
          </div>
        )}
        {error && (
          <div style={{ marginTop: 12 }}>
            <DsBanner tone="danger" title="Could not invite member" description={error} />
          </div>
        )}
      </div>
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
  const [confirmRemove, setConfirmRemove] = React.useState(false);

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
          fontSize: 13.5,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={member.name} email={member.email} size={32} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 13.5 }}>{member.name ?? member.email}</b>
              <StatusPill status="active" label={member.role} />
              {isSelf && (
                <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                  (you)
                </span>
              )}
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
              {member.email}
            </div>
          </div>
        </div>
        {canAdminister && !isSelf && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={member.role}
              onChange={(e) =>
                void act(() => updateMemberRole(orgId, member.id, e.target.value as Role))
              }
              className="ds-select"
              style={{ height: 32, width: "auto", fontSize: 12.5 }}
              aria-label={`Role for ${member.email}`}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="ds-btn ds-btn-danger ds-btn-sm"
            >
              <Trash2 size={12} />
              <span>Remove</span>
            </button>
          </div>
        )}
      </div>
      {error && (
        <div style={{ padding: "0 16px 12px" }}>
          <DsBanner tone="danger" title="Member update failed" description={error} />
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          setConfirmRemove(false);
          await act(() => removeMember(orgId, member.id));
        }}
        title={`Remove ${member.email} from organization?`}
        description="They will immediately lose access to all projects, domains, and API keys in this organization."
        confirmLabel="Remove member"
      />
    </div>
  );
}

export function RevokeInviteButton({ orgId, inviteId }: { orgId: string; inviteId: string }) {
  const router = useRouter();
  const [done, setDone] = React.useState(false);
  if (done) return <StatusPill status="revoked" />;
  return (
    <button
      type="button"
      onClick={async () => {
        await revokeInvite(orgId, inviteId);
        setDone(true);
        router.refresh();
      }}
      className="ds-btn ds-btn-danger ds-btn-sm"
    >
      <Trash2 size={12} />
      <span>Revoke</span>
    </button>
  );
}
