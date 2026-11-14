"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createInbox, createProjectInbox, setInboxMember, setInboxRoute } from "../actions";
import { DsBanner, DsButton, DsInput, DsSelect } from "../../../../components/design-system";

/** Create an inbox with its first routing address. */
export function NewInboxForm({
  projectId,
  domains,
  senders,
}: {
  projectId: string;
  domains: Array<{ id: string; domain: string; status: string }>;
  senders: Array<{ id: string; email: string }>;
}) {
  const router = useRouter();
  const verified = domains.filter((d) => d.status === "verified");
  const [name, setName] = React.useState("");
  const [domainId, setDomainId] = React.useState(verified[0]?.id ?? "");
  const [localPart, setLocalPart] = React.useState("support");
  const [senderId, setSenderId] = React.useState(senders[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await createProjectInbox({
        projectId,
        name,
        receivingDomainId: domainId,
        localPart,
        defaultSenderId: senderId || null,
      });
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the inbox.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">New inbox</h2>
          <p className="ds-card-subtitle">
            An inbox is where received mail is managed. Its sender identity is only used for replies
            — choosing one never changes what arrives.
          </p>
        </div>
      </div>
      <div className="ds-card-body">
        {verified.length === 0 && (
          <div style={{ marginBottom: 12 }}>
            <DsBanner
              tone="warning"
              title="No verified receiving domain yet"
              description="An inbox needs an address on a domain you have verified. Add one under Receiving first."
            />
          </div>
        )}
        {error && (
          <div style={{ marginBottom: 12 }}>
            <DsBanner tone="danger" title="Not created" description={error} />
          </div>
        )}
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            Name
            <DsInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Support" />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            Receiving domain
            <DsSelect value={domainId} onChange={(e) => setDomainId(e.target.value)}>
              {verified.length === 0 && <option value="">None verified</option>}
              {verified.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.domain}
                </option>
              ))}
            </DsSelect>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            Address (or * for catch-all)
            <DsInput
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              placeholder="support"
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
            Reply sender (optional)
            <DsSelect value={senderId} onChange={(e) => setSenderId(e.target.value)}>
              <option value="">No replies</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email}
                </option>
              ))}
            </DsSelect>
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <DsButton
            onClick={create}
            disabled={busy || !domainId || name.trim().length < 2}
            icon={<Plus size={14} />}
          >
            {busy ? "Creating…" : "Create inbox"}
          </DsButton>
        </div>
      </div>
    </div>
  );
}

export function InboxAdmin({
  inboxId,
  name,
  defaultSenderId,
  senders,
  canManage,
}: {
  inboxId: string;
  name: string;
  defaultSenderId: string | null;
  senders: Array<{ id: string; email: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(name);
  const [sender, setSender] = React.useState(defaultSenderId ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await createInbox({ inboxId, name: value, defaultSenderId: sender || null });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {error && <DsBanner tone="danger" title="Not saved" description={error} />}
      <DsInput
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!canManage || busy}
        aria-label="Inbox name"
      />
      <DsSelect
        value={sender}
        onChange={(e) => setSender(e.target.value)}
        disabled={!canManage || busy}
        aria-label="Default sender identity"
      >
        <option value="">No replies</option>
        {senders.map((s) => (
          <option key={s.id} value={s.id}>
            {s.email}
          </option>
        ))}
      </DsSelect>
      <DsButton variant="secondary" onClick={save} disabled={!canManage || busy}>
        {busy ? "Saving…" : "Save"}
      </DsButton>
    </div>
  );
}

export function InboxRouteRow({
  inboxId,
  receivingDomainId,
  localPart,
  address,
  domains,
  canManage,
}: {
  inboxId: string;
  receivingDomainId: string;
  localPart: string;
  address: string;
  domains?: Array<{ id: string; domain: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newLocal, setNewLocal] = React.useState("");
  const [newDomain, setNewDomain] = React.useState(domains?.[0]?.id ?? "");

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await setInboxRoute({
        inboxId,
        receivingDomainId: newDomain,
        localPart: newLocal,
        enabled: true,
      });
      setNewLocal("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the address.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await setInboxRoute({ inboxId, receivingDomainId, localPart, enabled: false });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the address.");
    } finally {
      setBusy(false);
    }
  }

  if (domains) {
    // The "add" row.
    if (!canManage || domains.length === 0) return null;
    return (
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {error && <DsBanner tone="danger" title="Not saved" description={error} />}
        <div style={{ display: "flex", gap: 6 }}>
          <DsInput
            value={newLocal}
            onChange={(e) => setNewLocal(e.target.value)}
            placeholder="billing or *"
            aria-label="Local part"
            style={{ flex: "1 1 100px" }}
          />
          <DsSelect
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            aria-label="Receiving domain"
          >
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.domain}
              </option>
            ))}
          </DsSelect>
          <DsButton
            variant="secondary"
            onClick={add}
            disabled={busy || newLocal.trim().length === 0}
            icon={<Plus size={13} />}
          >
            Add
          </DsButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginTop: 6 }}>
      {error && <DsBanner tone="danger" title="Not saved" description={error} />}
      <span className="mono">{address}</span>
      {canManage && (
        <button
          type="button"
          className="ds-btn ds-btn-ghost"
          onClick={remove}
          disabled={busy}
          aria-label={`Remove ${address}`}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

export function InboxPeople({
  inboxId,
  members,
  roster,
  canManage,
}: {
  inboxId: string;
  members: Array<{ userId: string; name: string | null; email: string; role: string }>;
  roster: Array<{ userId: string; name: string | null; email: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function change(userId: string, role: "viewer" | "member" | "manager" | "none") {
    setBusy(userId);
    setError(null);
    try {
      await setInboxMember({ inboxId, userId, role });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change access.");
    } finally {
      setBusy(null);
    }
  }

  const memberIds = new Set(members.map((m) => m.userId));

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {error && <DsBanner tone="danger" title="Not saved" description={error} />}
      {members.length === 0 && (
        <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
          Nobody has been added. Organisation owners and admins can still open it.
        </p>
      )}
      {members.map((member) => (
        <div key={member.userId} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{
              fontSize: 12,
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {member.name ?? member.email}
          </span>
          <DsSelect
            value={member.role}
            disabled={!canManage || busy === member.userId}
            onChange={(e) =>
              change(member.userId, e.target.value as "viewer" | "member" | "manager" | "none")
            }
            aria-label={`Role for ${member.email}`}
          >
            <option value="viewer">Viewer</option>
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="none">Remove</option>
          </DsSelect>
        </div>
      ))}
      {canManage && roster.some((person) => !memberIds.has(person.userId)) && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <DsSelect
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) change(e.target.value, "member");
              e.target.value = "";
            }}
            aria-label="Add a teammate"
          >
            <option value="">Add teammate…</option>
            {roster
              .filter((person) => !memberIds.has(person.userId))
              .map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name ?? person.email}
                </option>
              ))}
          </DsSelect>
        </div>
      )}
    </div>
  );
}
