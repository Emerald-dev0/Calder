"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createOrganization, createProject } from "../onboarding/actions";
import { ENVIRONMENTS, type Environment } from "../../../lib/onboarding";
import { StatusPill } from "../../../components/design-system";

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
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Organization name (e.g. Acme Infrastructure)"
        aria-label="Organization name"
        className="ds-input"
        style={{ minWidth: 220, flex: 1 }}
      />
      <button type="submit" disabled={busy || !name.trim()} className="ds-btn ds-btn-primary">
        <Plus size={14} />
        <span>{busy ? "Creating…" : "Create organization"}</span>
      </button>
      {msg && (
        <StatusPill
          status={msg.ok ? "verified" : "failed"}
          label={msg.text}
        />
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
        className="ds-select"
        style={{ width: "auto", minWidth: 160 }}
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
        placeholder="Project name (e.g. Core Transactional)"
        aria-label="Project name"
        className="ds-input"
        style={{ minWidth: 200, flex: 1 }}
      />
      <select
        value={env}
        onChange={(e) => setEnv(e.target.value as Environment)}
        aria-label="Environment"
        className="ds-select"
        style={{ width: "auto", minWidth: 140 }}
      >
        {ENVIRONMENTS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy || !name.trim()} className="ds-btn ds-btn-primary">
        <Plus size={14} />
        <span>{busy ? "Creating…" : "Create project"}</span>
      </button>
      {msg && (
        <StatusPill
          status={msg.ok ? "verified" : "failed"}
          label={msg.text}
        />
      )}
    </form>
  );
}
