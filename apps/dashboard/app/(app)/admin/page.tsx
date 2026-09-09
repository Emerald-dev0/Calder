import { desc, eq, count, inArray } from "drizzle-orm";
import { getDb, users, emails, emailEvents, waitlistSignups, subscriptions } from "@calder/db";
import { getConfig } from "@calder/config";
import { getTenantContext } from "../../../lib/auth";

function isFounder(email: string): boolean {
  const founders = (getConfig().FOUNDER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return founders.includes(email.toLowerCase());
}

export default async function AdminPage() {
  const ctx = await getTenantContext();
  if (!isFounder(ctx.user.email)) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Admin</h1>
        <p style={{ color: "#737373" }}>
          Platform analytics are restricted to founders. Your account isn&rsquo;t on the list.
        </p>
      </div>
    );
  }

  const db = getDb();
  const userRows = await db.select({ value: count() }).from(users);
  const waitlistRows = await db.select({ value: count() }).from(waitlistSignups);
  const emailRows = await db.select({ value: count() }).from(emails);
  const userCount = userRows[0]?.value ?? 0;
  const waitlistCount = waitlistRows[0]?.value ?? 0;
  const emailCount = emailRows[0]?.value ?? 0;
  const paidRows = await db
    .select({ value: count() })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));
  const paidCount = paidRows[0]?.value ?? 0;

  const failures = await db
    .select({
      id: emailEvents.id,
      type: emailEvents.type,
      createdAt: emailEvents.createdAt,
      subject: emails.subject,
      to: emails.to,
    })
    .from(emailEvents)
    .innerJoin(emails, eq(emailEvents.emailId, emails.id))
    .where(inArray(emailEvents.type, ["failed", "bounced", "complained"]))
    .orderBy(desc(emailEvents.createdAt))
    .limit(20);

  const signups = await db
    .select()
    .from(waitlistSignups)
    .orderBy(desc(waitlistSignups.createdAt))
    .limit(50);

  const cards = [
    { label: "Total emails sent", value: String(emailCount) },
    { label: "Users", value: String(userCount) },
    { label: "Paid (active subs)", value: String(paidCount) },
    { label: "Waitlist signups", value: String(waitlistCount) },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Platform</h1>
      <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
        Founder-only. Every number below is a live query — nothing here is mocked.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {cards.map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #E5E5E5",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <p style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{s.value}</p>
            <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Delivery health — recent failures</p>
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 24,
        }}
      >
        {failures.length === 0 && (
          <p style={{ padding: 20, color: "#16A34A", fontSize: 14, margin: 0 }}>
            Clean — no failed, bounced, or complained events on record.
          </p>
        )}
        {failures.map((f, i) => (
          <div
            key={f.id}
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
              <b>{f.subject}</b> <span style={{ color: "#737373" }}>→ {f.to}</span>
            </span>
            <span className="mono" style={{ fontSize: 12, color: "#DC2626" }}>
              {f.type}
            </span>
          </div>
        ))}
      </div>
      <p className="caption" style={{ margin: "-12px 0 24px", color: "#737373", fontSize: 12 }}>
        App-crash reporting (Sentry) is not yet integrated — this panel covers delivery failures.
        Follow-up tracked in the roadmap.
      </p>

      <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Waitlist ({waitlistCount})</p>
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {signups.length === 0 && (
          <p style={{ padding: 20, color: "#737373", fontSize: 14, margin: 0 }}>No signups yet.</p>
        )}
        {signups.map((s, i) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 16px",
              borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
              fontSize: 14,
            }}
          >
            <span className="mono" style={{ fontSize: 13 }}>
              {s.email}
            </span>
            <span style={{ fontSize: 12, color: "#737373" }}>
              {s.referralCode} · {s.referredBy ? `via ${s.referredBy}` : "organic"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
