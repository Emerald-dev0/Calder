"use client";

import * as React from "react";
import {
  createOrganization,
  createProject,
  createTestKey,
  listTestKeys,
  sendFirstEmail,
  getEmailStatus,
  addDomain,
  checkDomainDns,
  saveProfile,
  completeOnboarding,
  listTransports,
  type DnsRecord,
} from "./actions";
import { createDomainSender } from "../senders/actions";
import {
  USE_CASES,
  VOLUMES,
  ENVIRONMENTS,
  PROFILE_ROLES,
  PROJECT_TYPES,
  DISCOVERY_SOURCES,
  AI_ASSISTANTS,
  PRIMARY_GOALS,
  type Environment,
} from "../../../lib/onboarding";
import { ArrivalMoment } from "../../../components/arrival-moment";

interface Org {
  id: string;
  name: string;
  slug: string;
}

export interface InitialProfile {
  name: string;
  username: string;
  projectTypes: string[];
  primaryGoal: string;
  role: string;
  referralSource: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  border: "1px solid #D4D4D4",
  borderRadius: 10,
  padding: "0 14px",
  fontSize: 15,
  background: "#fff",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  background: "#0B0C0E",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  height: 44,
  padding: "0 22px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  background: "#fff",
  color: "#0B0C0E",
  border: "1px solid #D4D4D4",
  borderRadius: 10,
  height: 44,
  padding: "0 22px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function FirstSenderForm({
  projectId,
  domain,
  busy,
  onCreated,
  onError,
}: {
  projectId: string | null;
  domain: string;
  busy: boolean;
  onCreated: (id: string) => void;
  onError: (m: string | null) => void;
}) {
  const [displayName, setDisplayName] = React.useState("");
  const [localPart, setLocalPart] = React.useState("hello");
  const [working, setWorking] = React.useState(false);
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E5E5",
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>Create your first sender</p>
      <p style={{ fontSize: 12, color: "#737373", margin: "0 0 12px" }}>
        Who should your first emails come from?
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Display name"
          aria-label="Display name"
          style={{
            flex: 1,
            minWidth: 140,
            height: 38,
            border: "1px solid #D4D4D4",
            borderRadius: 8,
            padding: "0 10px",
            fontSize: 13,
          }}
        />
        <input
          value={localPart}
          onChange={(e) => setLocalPart(e.target.value)}
          placeholder="hello"
          aria-label="Local part"
          style={{
            width: 130,
            height: 38,
            border: "1px solid #D4D4D4",
            borderRadius: 8,
            padding: "0 10px",
            fontSize: 13,
          }}
        />
        <span className="mono" style={{ alignSelf: "center", fontSize: 12, color: "#525252" }}>
          @{domain || "your domain"}
        </span>
        <button
          type="button"
          disabled={busy || working || !projectId}
          onClick={async () => {
            if (!projectId) return;
            setWorking(true);
            onError(null);
            try {
              const r = await createDomainSender({ projectId, displayName, localPart, domain });
              onCreated(r.id);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Could not create sender.");
            }
            setWorking(false);
          }}
          style={{
            background: "#0B0C0E",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "0 16px",
            height: 38,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {working ? "Creating…" : "Create sender"}
        </button>
      </div>
    </div>
  );
}

function Err({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" style={{ color: "#DC2626", fontSize: 14, margin: "12px 0 0" }}>
      {message}
    </p>
  );
}

export function OnboardingWizard({
  orgs,
  initialProfile,
  orgsWithDeliveries,
  initialNotice,
  initialStep,
}: {
  orgs: Org[];
  initialProfile: InitialProfile;
  orgsWithDeliveries: string[];
  initialNotice?: string;
  initialStep?: number;
}) {
  const [step, setStep] = React.useState(initialStep ?? 0);
  const [welcomed, setWelcomed] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(initialNotice ?? null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [displayName, setDisplayName] = React.useState(initialProfile.name);
  const [username, setUsername] = React.useState(initialProfile.username);
  const [role, setRole] = React.useState(initialProfile.role || "Developer");
  const [referralSource, setReferralSource] = React.useState(
    initialProfile.referralSource || "Google / Search"
  );
  const [discoveryDetail, setDiscoveryDetail] = React.useState("");
  const [projectTypes, setProjectTypes] = React.useState<string[]>(initialProfile.projectTypes);
  const [primaryGoal, setPrimaryGoal] = React.useState(initialProfile.primaryGoal);
  const [profileScreen, setProfileScreen] = React.useState(0);
  const [done, setDone] = React.useState(false);

  const [orgId, setOrgId] = React.useState<string | null>(orgs[0]?.id ?? null);
  const [orgName, setOrgName] = React.useState("");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [projectName, setProjectName] = React.useState("");
  const [environment, setEnvironment] = React.useState<Environment>("production");
  const [useCases, setUseCases] = React.useState<string[]>([]);
  const [volume, setVolume] = React.useState<string>(VOLUMES[0] as string);
  const [keySecret, setKeySecret] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<
    Array<{ id: string; name: string; prefix: string; revokedAt: string | null }>
  >([]);
  const [to, setTo] = React.useState("");
  const [emailId, setEmailId] = React.useState<string | null>(null);
  const [emailStatus, setEmailStatus] = React.useState<string | null>(null);
  const [domain, setDomain] = React.useState("");
  const [records, setRecords] = React.useState<DnsRecord[] | null>(null);
  const [domainId, setDomainId] = React.useState<string | null>(null);
  const [domainState, setDomainState] = React.useState<"pending" | "verified" | null>(null);
  const [senderCreated, setSenderCreated] = React.useState<string | null>(null);
  const [dnsDetail, setDnsDetail] = React.useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Poll delivery status once an email is away.
  React.useEffect(() => {
    if (!emailId || !projectId) return;
    if (emailStatus === "sent" || emailStatus === "delivered" || emailStatus === "failed") return;
    const id = setInterval(async () => {
      try {
        const s = await getEmailStatus({ projectId, emailId });
        setEmailStatus(s.status);
      } catch {
        /* keep polling */
      }
    }, 2000);
    const stop = setTimeout(() => clearInterval(id), 90000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [emailId, projectId, emailStatus]);

  const steps = [
    "Profile",
    "Organization",
    "Project",
    "Sending",
    "API key",
    "First send",
    "Domain",
  ];

  type Transport = {
    id: string;
    type: string;
    label: string;
    status: string;
    isDefault: boolean;
    dailyCap: number | null;
  };
  const [transports, setTransports] = React.useState<Transport[]>([]);
  const [transportsState, setTransportsState] = React.useState<"idle" | "loading" | "ready">(
    "idle"
  );

  async function refreshTransports(pid: string) {
    setTransportsState("loading");
    try {
      setTransports(await listTransports(pid));
      setTransportsState("ready");
    } catch {
      setTransportsState("idle");
    }
  }

  React.useEffect(() => {
    if (step === 3 && projectId && transportsState === "idle") {
      void refreshTransports(projectId);
    }
  });

  async function finish() {
    const r = await run(async () => {
      await completeOnboarding();
      return true;
    });
    if (r) setDone(true);
  }

  if (!welcomed) {
    return (
      <div style={{ maxWidth: 640 }} className="wizard-step">
        <p style={{ fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>Calder</p>
        <h1 style={{ fontSize: 30, letterSpacing: "-0.02em", margin: "0 0 10px" }}>
          Welcome. Let&rsquo;s get your first message out.
        </h1>
        <p style={{ color: "#737373", fontSize: 15, margin: "0 0 24px", lineHeight: 1.6 }}>
          Communication infrastructure for your applications. Three short moves and you&rsquo;ll
          have proof in your inbox.
        </p>
        <ol style={{ margin: "0 0 28px", paddingLeft: 20, fontSize: 14, lineHeight: 2 }}>
          <li>
            <b>Organization & project</b>
            <span style={{ color: "#737373" }}> — who owns the mail, what sends it.</span>
          </li>
          <li>
            <b>Sending setup</b>
            <span style={{ color: "#737373" }}>
              {" "}
              — shared test sender, your Gmail, or your domain.
            </span>
          </li>
          <li>
            <b>First send</b>
            <span style={{ color: "#737373" }}> — a real delivery, on the record.</span>
          </li>
        </ol>
        <button style={btnPrimary} onClick={() => setWelcomed(true)}>
          Start setup →
        </button>
      </div>
    );
  }

  const noticeText =
    notice === "gmail-ok"
      ? "Gmail connected — this project can now send from your address."
      : notice === "gmail-failed"
        ? "Gmail connect didn\u2019t finish. Try again, or continue with the test sender."
        : notice?.startsWith("gmail-start:")
          ? notice.slice("gmail-start:".length)
          : null;

  return (
    <div style={{ maxWidth: 640 }} key={`${step}-${profileScreen}`} className="wizard-step">
      {noticeText && (
        <p
          style={{
            fontSize: 13,
            borderRadius: 10,
            padding: "10px 14px",
            margin: "0 0 16px",
            color: notice === "gmail-ok" ? "#166534" : "#92400E",
            background: notice === "gmail-ok" ? "#F0FDF4" : "#FFFBEB",
            border: notice === "gmail-ok" ? "1px solid #BBF7D0" : "1px solid #FDE68A",
          }}
        >
          {noticeText}{" "}
          {notice !== "gmail-ok" && (
            <button
              type="button"
              onClick={() => setNotice(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                textDecoration: "underline",
                color: "inherit",
              }}
            >
              Dismiss
            </button>
          )}
        </p>
      )}
      <ol style={{ display: "flex", gap: 6, listStyle: "none", padding: 0, margin: "0 0 28px" }}>
        {steps.map((s, i) => (
          <li
            key={s}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= step ? "#0B0C0E" : "#E5E5E5",
            }}
            title={s}
          />
        ))}
      </ol>

      {step === 0 && profileScreen === 0 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>What best describes you?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Your profile travels with you across every organization.
          </p>
          <Field label="Your name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ada Engineer"
              style={inputStyle}
              autoComplete="name"
            />
          </Field>
          <Field label="Username (unique, lowercase)">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="ada"
              style={inputStyle}
              autoComplete="username"
            />
          </Field>
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 20px" }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>I am a…</legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              {PROFILE_ROLES.map((r) => {
                const on = role === r.value;
                return (
                  <label
                    key={r.value}
                    style={{
                      display: "block",
                      border: on ? "2px solid #0B0C0E" : "1px solid #D4D4D4",
                      background: on ? "#F5F4EF" : "#fff",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="profile-role"
                      value={r.value}
                      checked={on}
                      onChange={() => setRole(r.value)}
                      style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                    />
                    <span style={{ fontWeight: on ? 700 : 400 }}>
                      {on ? "✓ " : ""}
                      {r.value}
                    </span>
                    <br />
                    <span style={{ color: "#737373", fontSize: 12 }}>{r.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button style={btnPrimary} disabled={busy} onClick={() => setProfileScreen(1)}>
            Continue →
          </button>
          <Err message={error} />
        </div>
      )}

      {step === 0 && profileScreen === 1 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>What are you building?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Pick any that apply, it shapes your starting project.
          </p>
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 20px" }}>
            <legend className="mono" style={{ fontSize: 11, color: "#737373", marginBottom: 8 }}>
              PROJECT TYPES
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PROJECT_TYPES.map((t) => {
                const on = projectTypes.includes(t);
                return (
                  <label
                    key={t}
                    style={{
                      border: on ? "2px solid #0B0C0E" : "1px solid #D4D4D4",
                      background: on ? "#F5F4EF" : "#fff",
                      borderRadius: 999,
                      padding: "8px 14px",
                      fontSize: 13,
                      fontWeight: on ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setProjectTypes(
                          on ? projectTypes.filter((x) => x !== t) : [...projectTypes, t]
                        )
                      }
                      style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                    />
                    {on ? "✓ " : ""}
                    {t}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnSecondary} onClick={() => setProfileScreen(0)}>
              ← Back
            </button>
            <button style={btnPrimary} disabled={busy} onClick={() => setProfileScreen(2)}>
              Continue →
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 0 && profileScreen === 2 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>How did you hear about Calder?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Stays inside Calder, never published. Helps us meet the next developer.
          </p>
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 20px" }}>
            <legend className="mono" style={{ fontSize: 11, color: "#737373", marginBottom: 8 }}>
              DISCOVERY SOURCE
            </legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              {DISCOVERY_SOURCES.map((s) => {
                const on = referralSource === s;
                return (
                  <label
                    key={s}
                    style={{
                      display: "block",
                      border: on ? "2px solid #0B0C0E" : "1px solid #D4D4D4",
                      background: on ? "#F5F4EF" : "#fff",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 13,
                      fontWeight: on ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="discovery-source"
                      value={s}
                      checked={on}
                      onChange={() => {
                        setReferralSource(s);
                        if (s !== "AI assistant") setDiscoveryDetail("");
                      }}
                      style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                    />
                    {on ? "✓ " : ""}
                    {s}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {referralSource === "AI assistant" && (
            <Field label="Which one? (optional)">
              <select
                value={discoveryDetail}
                onChange={(e) => setDiscoveryDetail(e.target.value)}
                style={inputStyle}
              >
                <option value="">Pick one…</option>
                {AI_ASSISTANTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnSecondary} onClick={() => setProfileScreen(1)}>
              ← Back
            </button>
            <button style={btnPrimary} disabled={busy} onClick={() => setProfileScreen(3)}>
              Continue →
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 0 && profileScreen === 3 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>What are you here to do?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            One pick, it decides what we emphasize next.
          </p>
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 20px" }}>
            <legend className="mono" style={{ fontSize: 11, color: "#737373", marginBottom: 8 }}>
              PRIMARY GOAL
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 440 }}>
              {PRIMARY_GOALS.map((g) => {
                const on = primaryGoal === g;
                return (
                  <label
                    key={g}
                    style={{
                      display: "block",
                      border: on ? "2px solid #0B0C0E" : "1px solid #D4D4D4",
                      background: on ? "#F5F4EF" : "#fff",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      fontWeight: on ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="primary-goal"
                      value={g}
                      checked={on}
                      onChange={() => setPrimaryGoal(g)}
                      style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                    />
                    {on ? "✓ " : ""}
                    {g}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnSecondary} onClick={() => setProfileScreen(2)}>
              ← Back
            </button>
            <button
              style={btnPrimary}
              disabled={busy || !primaryGoal}
              onClick={() =>
                run(async () => {
                  await saveProfile({
                    name: displayName,
                    username,
                    role,
                    referralSource,
                    discoveryDetail,
                    projectTypes,
                    primaryGoal,
                  });
                  setStep(1);
                })
              }
            >
              Save & continue →
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 1 && (
        <div>
          <p style={{ fontSize: 13, color: "#16A34A", fontWeight: 600, margin: "0 0 6px" }}>
            Profile done. Now let&rsquo;s build.
          </p>
          <h2 style={{ margin: "0 0 6px" }}>Where does this belong?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Organizations own billing and members. Most people need exactly one.
          </p>
          {orgs.length > 0 && (
            <Field label="Use an existing organization">
              <select
                value={orgId ?? ""}
                onChange={(e) => setOrgId(e.target.value)}
                style={inputStyle}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={orgs.length > 0 ? "Or create a new one" : "Organization name"}>
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Inc"
              style={inputStyle}
            />
          </Field>
          <button
            style={btnPrimary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (orgName.trim()) {
                  const org = await createOrganization(orgName);
                  setOrgId(org.orgId);
                }
                if (!orgId && !orgName.trim()) throw new Error("Pick or name an organization.");
                setStep(2);
              })
            }
          >
            Continue →
          </button>
          <Err message={error} />
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>What are you sending from?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            A project is one app or environment. This also tells us what to optimize for.
          </p>
          <Field label="Project name">
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="acme-production"
              style={inputStyle}
            />
          </Field>
          <Field label="Environment">
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as Environment)}
              style={inputStyle}
            >
              {ENVIRONMENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What will you send? (pick any)">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {USE_CASES.map((u) => {
                const on = useCases.includes(u);
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() =>
                      setUseCases(on ? useCases.filter((x) => x !== u) : [...useCases, u])
                    }
                    style={{
                      border: on ? "2px solid #0B0C0E" : "1px solid #D4D4D4",
                      background: on ? "#F5F4EF" : "#fff",
                      borderRadius: 999,
                      padding: "8px 14px",
                      fontSize: 13,
                      fontWeight: on ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {u}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Rough monthly volume">
            <select value={volume} onChange={(e) => setVolume(e.target.value)} style={inputStyle}>
              {VOLUMES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnSecondary} onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              style={btnPrimary}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!orgId) throw new Error("Pick an organization first.");
                  const p = await createProject({
                    orgId,
                    name: projectName,
                    environment,
                    useCases,
                    volume,
                  });
                  setProjectId(p.projectId);
                  setTransportsState("idle");
                  setStep(3);
                })
              }
            >
              Create project →
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 3 && (
        <div>
          <div
            role="img"
            aria-label="Your app sends through the Calder API, out an email transport, to your recipient."
            style={{
              background: "#fff",
              border: "1px solid #E5E5E5",
              borderRadius: 12,
              padding: "16px",
              marginBottom: 20,
            }}
          >
            <svg viewBox="0 0 560 120" style={{ width: "100%", height: "auto", display: "block" }}>
              {[
                { x: 8, label: "Your app" },
                { x: 152, label: "Calder API" },
                { x: 296, label: "Transport" },
                { x: 440, label: "Recipient" },
              ].map((n, i) => (
                <g key={n.label}>
                  <rect
                    x={n.x}
                    y={38}
                    width={112}
                    height={44}
                    rx={8}
                    fill={i === 1 ? "#0B0C0E" : "#F5F4EF"}
                    stroke="#0B0C0E"
                    strokeWidth={1.5}
                  />
                  <text
                    x={n.x + 56}
                    y={63}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill={i === 1 ? "#F5F4EF" : "#0B0C0E"}
                  >
                    {n.label}
                  </text>
                  {i < 3 && (
                    <line
                      x1={n.x + 112}
                      y1={60}
                      x2={n.x + 152}
                      y2={60}
                      stroke="#0B0C0E"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      className="pipe-flow"
                    />
                  )}
                </g>
              ))}
            </svg>
            <p className="mono" style={{ fontSize: 11, color: "#737373", margin: "8px 0 0" }}>
              send → track → verify. Only what exists, nothing promised early.
            </p>
          </div>
          <h2 style={{ margin: "0 0 6px" }}>How should this project send?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Test sends ride Calder&rsquo;s shared sender and work right now. Gmail and your own
            domain are optional upgrades, connect either whenever you&rsquo;re ready.
          </p>
          {transportsState === "ready" && transports.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E5E5",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
              }}
            >
              {transports.map((t) => (
                <p key={t.id} style={{ fontSize: 14, margin: "0 0 6px" }}>
                  <b>{t.label}</b>{" "}
                  <span style={{ color: "#737373", fontSize: 12 }}>
                    · {t.type} · {t.status}
                    {t.isDefault ? " · default" : ""}
                    {t.dailyCap ? ` · ${t.dailyCap}/day cap` : ""}
                  </span>
                </p>
              ))}
              <button
                type="button"
                style={{ ...btnSecondary, marginTop: 8 }}
                disabled={busy || !projectId}
                onClick={() => projectId && void refreshTransports(projectId)}
              >
                Refresh status
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 440 }}>
            <button style={btnPrimary} disabled={busy} onClick={() => setStep(4)}>
              Continue with the test sender →
            </button>
            <a
              href={projectId ? `/api/auth/gmail/connect?project=${projectId}` : "#"}
              onClick={(e) => {
                if (!projectId) e.preventDefault();
              }}
              style={{
                ...btnSecondary,
                textDecoration: "none",
                textAlign: "center",
                lineHeight: "44px",
                opacity: projectId ? 1 : 0.5,
              }}
              aria-disabled={!projectId}
            >
              Connect Gmail
            </a>
            {!projectId && (
              <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>
                Create the project first, Gmail connects to a specific project.
              </p>
            )}
            <button style={btnSecondary} disabled={busy} onClick={() => setStep(6)}>
              I have a domain, verify it
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Here&rsquo;s your test key</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Test keys run the full pipeline with zero real delivery. The secret shows once, copy it
            now.
          </p>
          <button
            style={btnSecondary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!projectId) return;
                const k = await createTestKey(projectId, "onboarding key");
                setKeySecret(k.secret);
                setKeys(await listTestKeys(projectId));
              })
            }
          >
            {keySecret ? "Create another key" : "Create test key"}
          </button>
          {keySecret && (
            <div
              style={{
                marginTop: 16,
                background: "#0B0C0E",
                color: "#fff",
                borderRadius: 10,
                padding: "14px 16px",
                fontFamily: "monospace",
                fontSize: 13,
                wordBreak: "break-all",
              }}
            >
              {keySecret}
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#B5B5B5",
                  marginTop: 6,
                  fontFamily: "sans-serif",
                }}
              >
                Shown once. It will never appear again, store it in your .env now.
              </span>
            </div>
          )}
          {keys.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 13, color: "#737373" }}>
              Existing keys:{" "}
              {keys.map((k) => (
                <span key={k.id} className="mono" style={{ marginRight: 10 }}>
                  {k.name} ({k.prefix}…){k.revokedAt ? " [revoked]" : ""}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button style={btnSecondary} onClick={() => setStep(2)}>
              ← Back
            </button>
            <button style={btnPrimary} disabled={busy || !projectId} onClick={() => setStep(5)}>
              Continue to first send →
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 5 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Send one for real</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            {keySecret
              ? "This sends through your new key, the same path production uses."
              : "Create a key in the previous step first (or go back, your secret only shows once)."}
          </p>
          {!emailId ? (
            <>
              <Field label="Send to">
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  style={inputStyle}
                />
              </Field>
              <button
                style={btnPrimary}
                disabled={busy || !keySecret || !projectId}
                onClick={() =>
                  run(async () => {
                    if (!projectId || !keySecret) throw new Error("Create a test key first.");
                    const r = await sendFirstEmail({ projectId, keySecret, to });
                    setEmailId(r.emailId);
                    setEmailStatus("queued");
                  })
                }
              >
                Send test email →
              </button>
            </>
          ) : (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E5E5",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <p style={{ margin: "0 0 6px" }}>
                Status: <b className="mono">{emailStatus ?? "…"}</b>
              </p>
              {(emailStatus === "sent" || emailStatus === "delivered") && (
                <>
                  <p style={{ color: "#16A34A", fontWeight: 600, margin: "8px 0 16px" }}>
                    {orgId && orgsWithDeliveries.includes(orgId)
                      ? "Delivered through your own pipeline. That\u2019s the whole product, working."
                      : "Your first delivery just landed. That\u2019s the whole product, working."}
                  </p>
                  <ArrivalMoment firstEver={!(orgId && orgsWithDeliveries.includes(orgId))} />
                </>
              )}
              {emailStatus === "failed" && (
                <p style={{ color: "#DC2626", margin: "8px 0 0" }}>
                  Failed, check the worker logs and try again. Failures are diagnosable here, never
                  silent.
                </p>
              )}
              <div style={{ marginTop: 16 }}>
                <button style={btnPrimary} onClick={() => setStep(6)}>
                  Continue to domain →
                </button>
              </div>
            </div>
          )}
          <Err message={error} />
        </div>
      )}

      {step === 6 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Send from your own name</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Test sends work with no DNS at all. Real branding needs three records, paste, wait,
            verify.
          </p>
          {!records ? (
            <>
              <Field label="Domain">
                <input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="acme.com"
                  style={inputStyle}
                />
              </Field>
              <button
                style={btnPrimary}
                disabled={busy || !projectId}
                onClick={() =>
                  run(async () => {
                    if (!projectId) return;
                    const r = await addDomain(projectId, domain);
                    setDomainId(r.domainId);
                    setRecords(r.records);
                    setDomainState("pending");
                  })
                }
              >
                Add domain →
              </button>
            </>
          ) : (
            <div
              style={{
                background: "#fff",
                border: "1px solid #E5E5E5",
                borderRadius: 12,
                padding: 20,
              }}
            >
              {records.map((r) => (
                <div key={r.host} style={{ marginBottom: 14 }}>
                  <p className="mono" style={{ fontSize: 12, margin: "0 0 2px" }}>
                    {r.type} {r.host}
                  </p>
                  <p
                    className="mono"
                    style={{ fontSize: 12, margin: "0 0 2px", wordBreak: "break-all" }}
                  >
                    {r.value}
                  </p>
                  <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>{r.purpose}</p>
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
                <button
                  style={btnSecondary}
                  disabled={busy || !domainId || domainState === "verified"}
                  onClick={() =>
                    run(async () => {
                      if (!domainId) return;
                      const r = await checkDomainDns(domainId);
                      setDnsDetail(r.detail);
                      if (r.verified) setDomainState("verified");
                    })
                  }
                >
                  Check DNS now
                </button>
                {domainState === "verified" && (
                  <b style={{ color: "#16A34A", fontSize: 14 }}>Verified ✓</b>
                )}
              </div>
              {domainState === "verified" && !senderCreated && (
                <FirstSenderForm
                  projectId={projectId}
                  domain={domain}
                  busy={busy}
                  onCreated={(id) => setSenderCreated(id)}
                  onError={(m) => setError(m)}
                />
              )}
              {senderCreated && (
                <p style={{ fontSize: 13, color: "#16A34A", margin: "10px 0 0" }}>
                  Sender ready — your first sends can come from your own domain.
                </p>
              )}
              {dnsDetail && domainState !== "verified" && (
                <p style={{ fontSize: 13, color: "#737373", margin: "10px 0 0" }}>{dnsDetail}</p>
              )}
              <div style={{ marginTop: 16 }}>
                {!done ? (
                  <button style={btnPrimary} disabled={busy} onClick={() => void finish()}>
                    Finish setup →
                  </button>
                ) : (
                  <a
                    href={projectId ? `/emails?project=${projectId}` : "/emails"}
                    style={{
                      ...btnPrimary,
                      textDecoration: "none",
                      display: "inline-block",
                      lineHeight: "44px",
                    }}
                  >
                    Done, show me my emails →
                  </a>
                )}
              </div>
            </div>
          )}
          <Err message={error} />
        </div>
      )}
    </div>
  );
}
