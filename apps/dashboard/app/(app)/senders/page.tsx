import { eq, and } from "drizzle-orm";
import { getDb, domains, projectTransports } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { listSenders } from "./actions";
import { AddSender } from "./add-sender";

export const metadata = { title: "Calder — Senders" };

function timeAgo(d: Date | null): string {
  if (!d) return "never used";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_DOT: Record<string, string> = {
  verified: "#16A34A",
  connected: "#1E3A8A",
  pending: "#B45309",
  disabled: "#737373",
  failed: "#DC2626",
};

export default async function SendersPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Senders</h1>
        <p style={{ color: "#737373" }}>No project found. Create one to add senders.</p>
      </div>
    );
  }

  const db = getDb();
  const senders = await listSenders(scope.project.id);
  const verifiedDomains = await db
    .select({ domain: domains.domain })
    .from(domains)
    .where(and(eq(domains.projectId, scope.project.id), eq(domains.status, "verified")));
  const gmailTransports = await db
    .select({
      id: projectTransports.id,
      label: projectTransports.label,
      dailyCap: projectTransports.dailyCap,
    })
    .from(projectTransports)
    .where(
      and(
        eq(projectTransports.projectId, scope.project.id),
        eq(projectTransports.type, "gmail"),
        eq(projectTransports.status, "active")
      )
    );
  // M2.4 graduation prompt: Gmail is on-ramp, not infrastructure. The nudge
  // fires when real volume exists (7-day average over the graduation line,
  // or the daily cap already reached today).
  const { gmailNeedsGraduation } = await import("@calder/db");
  const graduations = await Promise.all(
    gmailTransports.map(async (t) => ({
      ...t,
      signal: await gmailNeedsGraduation(db, scope.project.id, t.dailyCap),
    }))
  );
  const graduates = graduations.filter((g) => g.signal.needed);
  const verifiedCount = senders.filter(
    (s) => s.status === "verified" || s.status === "connected"
  ).length;

  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Senders</h1>
      <p style={{ color: "#737373", margin: "0 0 4px", fontSize: 14 }}>
        {scope.organization.name} → {scope.project.name} ·{" "}
        {senders.length === 0 ? "no senders yet" : `${verifiedCount} of ${senders.length} ready`}
      </p>

      {graduates.length > 0 && (
        <div
          role="status"
          style={{
            background: "#FFF8E6",
            border: "1px solid #F0DFA8",
            borderRadius: 12,
            padding: 16,
            margin: "12px 0 4px",
            fontSize: 14,
          }}
        >
          <p style={{ fontWeight: 700, margin: "0 0 4px" }}>
            You've outgrown Gmail ({graduates.map((g) => g.label).join(", ")}).
          </p>
          <p style={{ margin: "0 0 8px", color: "#5C4E2F" }}>
            This project is averaging{" "}
            <b>{Math.max(...graduates.map((g) => Math.round(g.signal.dailyAvg7d)))} sends/day</b>{" "}
            through a personal Gmail account (cap {graduates[0]!.signal.cap}/day). Personal accounts
            get throttled, land in spam more often, and can be locked by Google at any volume.
            Verify a domain below to move onto production infrastructure — SES takes over
            automatically with no code change.
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            <a href="/domains" style={{ color: "#5C4E2F", textDecoration: "underline" }}>
              Add &amp; verify a domain →
            </a>
          </p>
        </div>
      )}

      {senders.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            padding: 32,
            margin: "20px 0",
            textAlign: "center",
          }}
        >
          <p style={{ fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
            No sender identities yet
          </p>
          <p style={{ color: "#737373", fontSize: 14, margin: "0 0 20px" }}>
            Your application needs a sender before Calder can deliver email. Start with an existing
            Gmail account, or verify your own domain.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "20px 0" }}>
          {senders.map((s) => (
            <a
              key={s.id}
              href={`/senders/${s.id}?project=${scope.project.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "#fff",
                border: "1px solid #E5E5E5",
                borderRadius: 12,
                padding: "14px 16px",
                textDecoration: "none",
                color: "#0B0C0E",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: STATUS_DOT[s.status] ?? "#737373",
                  flexShrink: 0,
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>
                  {s.displayName}{" "}
                  {s.isDefault && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        background: "#F5F4EF",
                        border: "1px solid #E5E5E5",
                        borderRadius: 999,
                        padding: "1px 7px",
                        fontWeight: 400,
                      }}
                    >
                      DEFAULT
                    </span>
                  )}
                </span>
                <span className="mono" style={{ display: "block", fontSize: 13, color: "#525252" }}>
                  {s.email}
                </span>
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 12,
                  color: "#737373",
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {s.status === "verified"
                  ? "✓ Verified"
                  : s.status === "connected"
                    ? "✓ Connected"
                    : s.status}
                <span style={{ display: "block", fontSize: 11 }}>{timeAgo(s.lastUsedAt)}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      <AddSender
        projectId={scope.project.id}
        verifiedDomains={verifiedDomains.map((d) => d.domain)}
        gmailTransports={gmailTransports}
      />
    </div>
  );
}
