"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrganization, createProject } from "../onboarding/actions";
import { ENVIRONMENTS, type Environment } from "../../../lib/onboarding";

const inputStyle = {
  width: "100%",
  height: 40,
  border: "1px solid #D4D4D4",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 14,
} as const;

const btnStyle = {
  background: "#0B0C0E",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "0 16px",
  height: 40,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;

/** Create a fresh organization (caller becomes owner). Any signed-in user. */
export function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await createOrganization(name);
          setName("");
          setMsg({ text: "Organization created.", ok: true });
          router.refresh();
        } catch (err) {
          setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
        }
        setBusy(false);
      }}
      style={{ display: "flex", gap: 8, marginBottom: 8 }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Organization name"
        aria-label="Organization name"
        style={{ ...inputStyle, minWidth: 0, flex: 1 }}
      />
      <button type="submit" disabled={busy} style={btnStyle}>
        {busy ? "Creating" : "Create"}
      </button>
      {msg && (
        <span style={{ fontSize: 12, alignSelf: "center", color: msg.ok ? "#16A34A" : "#DC2626" }}>
          {msg.text}
        </span>
      )}
    </form>
  );
}

/** Create a project inside an org you own or administer. */
export function NewProjectForm({ orgs }: { orgs: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [name, setName] = useState("");
  const [env, setEnv] = useState<Environment>("development");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (orgs.length === 0) return null;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await createProject({ orgId, name, environment: env, useCases: [], volume: "< 1k / mo" });
          setName("");
          setMsg({ text: "Project created.", ok: true });
          router.refresh();
        } catch (err) {
          setMsg({ text: err instanceof Error ? err.message : "Failed.", ok: false });
        }
        setBusy(false);
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <select
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        aria-label="Organization"
        style={{ ...inputStyle, width: "auto" }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        aria-label="Project name"
        style={{ ...inputStyle, minWidth: 0, flex: 1 }}
      />
      <select
        value={env}
        onChange={(e) => setEnv(e.target.value as Environment)}
        aria-label="Environment"
        style={{ ...inputStyle, width: "auto" }}
      >
        {ENVIRONMENTS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy} style={btnStyle}>
        {busy ? "Creating" : "Create"}
      </button>
      {msg && (
        <span style={{ fontSize: 12, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</span>
      )}
    </form>
  );
}
