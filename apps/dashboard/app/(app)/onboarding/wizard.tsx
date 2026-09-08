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
  type DnsRecord,
} from "./actions";
import {
  USE_CASES,
  VOLUMES,
  ENVIRONMENTS,
  ROLES,
  REFERRAL_SOURCES,
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
}: {
  orgs: Org[];
  initialProfile: InitialProfile;
}) {
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [displayName, setDisplayName] = React.useState(initialProfile.name);
  const [username, setUsername] = React.useState(initialProfile.username);
  const [role, setRole] = React.useState(initialProfile.role || (ROLES[0] as string));
  const [referralSource, setReferralSource] = React.useState(
    initialProfile.referralSource || (REFERRAL_SOURCES[0] as string)
  );
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

  const steps = ["Profile", "Organization", "Project", "API key", "First send", "Domain"];

  async function finish() {
    const r = await run(async () => {
      await completeOnboarding();
      return true;
    });
    if (r) setDone(true);
  }

  return (
    <div style={{ maxWidth: 640 }}>
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

      {step === 0 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Who are you?</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Your profile travels with you across every organization — pick a handle you&rsquo;ll
            keep.
          </p>
          <Field label="Your name">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ada Engineer"
              style={inputStyle}
            />
          </Field>
          <Field label="Username (unique, lowercase)">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="ada"
              style={inputStyle}
            />
          </Field>
          <Field label="I am a…">
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How did you hear about Avenor?">
            <select
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
              style={inputStyle}
            >
              {REFERRAL_SOURCES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <button
            style={btnPrimary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await saveProfile({ name: displayName, username, role, referralSource });
                setStep(1);
              })
            }
          >
            Continue →
          </button>
          <Err message={error} />
        </div>
      )}

      {step === 1 && (
        <div>
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
          <h2 style={{ margin: "0 0 6px" }}>Here&rsquo;s your test key</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Test keys run the full pipeline with zero real delivery. The secret shows once — copy it
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
                Shown once. It will never appear again — store it in your .env now.
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button style={btnSecondary} onClick={() => setStep(2)}>
              ← Back
            </button>
            <button style={btnPrimary} disabled={busy || !projectId} onClick={() => setStep(4)}>
              Continue to first send →
            </button>
          </div>
          <Err message={error} />
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Send one for real</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            {keySecret
              ? "This sends through your new key — the same path production uses."
              : "Create a key in the previous step first (or go back — your secret only shows once)."}
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
                    Delivered through your own pipeline. That&rsquo;s the whole product, working.
                  </p>
                  <ArrivalMoment />
                </>
              )}
              {emailStatus === "failed" && (
                <p style={{ color: "#DC2626", margin: "8px 0 0" }}>
                  Failed — check the worker logs and try again. Failures are diagnosable here, never
                  silent.
                </p>
              )}
              <div style={{ marginTop: 16 }}>
                <button style={btnPrimary} onClick={() => setStep(5)}>
                  Continue to domain →
                </button>
              </div>
            </div>
          )}
          <Err message={error} />
        </div>
      )}

      {step === 5 && (
        <div>
          <h2 style={{ margin: "0 0 6px" }}>Send from your own name</h2>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Test sends work with no DNS at all. Real branding needs three records — paste, wait,
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
                    Done — show me my emails →
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
