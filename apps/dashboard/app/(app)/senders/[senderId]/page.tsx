import { count, desc, eq } from "drizzle-orm";
import { getDb, emails, senderIdentities } from "@calder/db";
import { getTenantContext } from "../../../../lib/auth";
import { SenderActions } from "./sender-actions";

export async function generateMetadata({ params }: { params: { senderId: string } }) {
  return { title: `Calder — Sender ${params.senderId.slice(0, 18)}` };
}

const STATUS_DOT: Record<string, string> = {
  verified: "#16A34A",
  connected: "#1E3A8A",
  pending: "#B45309",
  disabled: "#737373",
  failed: "#DC2626",
};

function statusLabel(s: string): string {
  if (s === "verified") return "✓ Verified";
  if (s === "connected") return "✓ Connected";
  if (s === "pending") return "◷ Verification pending";
  if (s === "disabled") return "⊘ Disabled";
  return "✕ Failed";
}

export default async function SenderDetailPage({
  params,
}: {
  params: { senderId: string };
}) {
  const ctx = await getTenantContext();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  const db = getDb();
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(eq(senderIdentities.id, params.senderId))
    .limit(1);
  if (!sender || !projectIds.has(sender.projectId)) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Sender</h1>
        <p style={{ color: "#737373" }}>Sender not found in your projects.</p>
      </div>
    );
  }
  const projectId = sender.projectId;

  const totals = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(eq(emails.senderIdentityId, sender.id))
    .groupBy(emails.status);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const t of totals) {
    byStatus[t.status] = t.value;
    total += t.value;
  }
  const recent = await db
    .select({ id: emails.id, to: emails.to, subject: emails.subject, status: emails.status })
    .from(emails)
    .where(eq(emails.senderIdentityId, sender.id))
    .orderBy(desc(emails.createdAt))
    .limit(10);

  const org = ctx.memberships.flatMap((m) =>
    m.projects.filter((p) => p.id === projectId).map(() => m.organization)
  )[0];

  return (
    <div>
      <p style={{ fontSize: 13, margin: "0 0 8px" }}>
        <a href={`/senders?project=${projectId}`} style={{ color: "#737373" }}>
          ← Senders
        </a>
      </p>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>{sender.displayName}</h1>
      <p className="mono" style={{ fontSize: 14, color: "#525252", margin: "0 0 6px" }}>
        {sender.email}
      </p>
      <p style={{ fontSize: 13, margin: "0 0 20px" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: STATUS_DOT[sender.status] ?? "#737373",
            marginRight: 6,
          }}
        />
        {statusLabel(sender.status)}
        <span style={{ color: "#737373" }}>
          {" "}
          · {sender.type === "gmail" ? "Gmail sender" : sender.type === "domain" ? "Domain sender" : "Managed sender"}
          {sender.isDefault ? " · Default" : ""} · {org?.name ?? ""}
        </span>
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Emails sent", value: String(total) },
          { label: "Delivered", value: String(byStatus.delivered ?? 0) },
          {
            label: "Bounced + failed",
            value: String((byStatus.bounced ?? 0) + (byStatus.failed ?? 0)),
          },
        ].map((s) => (
          <div
            key={s.label}
            style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 12, padding: 16 }}
          >
            <p style={{ fontSize: 22, fontWeight: 700, margin: "0 0 2px" }}>{s.value}</p>
            <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <SenderActions
        sender={{
          id: sender.id,
          projectId,
          displayName: sender.displayName,
          email: sender.email,
          status: sender.status,
          isDefault: sender.isDefault,
          emailCount: total,
        }}
      />

      <p style={{ fontWeight: 600, margin: "24px 0 12px" }}>Recent deliveries</p>
      {recent.length === 0 ? (
        <p style={{ color: "#737373", fontSize: 14 }}>Nothing sent from this sender yet.</p>
      ) : (
        <div
          style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 12, overflow: "hidden" }}
        >
          {recent.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 16px",
                borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
                fontSize: 14,
              }}
            >
              <span>
                <b>{r.subject}</b> <span style={{ color: "#737373" }}>→ {r.to}</span>
              </span>
              <span className="mono" style={{ fontSize: 12, color: "#737373" }}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
