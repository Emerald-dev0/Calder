import Link from "next/link";

type Tier = "PRO" | "PREMIUM" | "SCALE";

interface PlanGateProps {
  title: string;
  description: string;
  tier: Tier;
  features?: string[];
  preview?: React.ReactNode;
}

const tierLabel: Record<Tier, string> = {
  PRO: "Available on Pro",
  PREMIUM: "Available on Premium",
  SCALE: "Available on Scale",
};

const tierCTA: Record<Tier, string> = {
  PRO: "Upgrade to Pro",
  PREMIUM: "Upgrade to Premium",
  SCALE: "Talk to Calder",
};

export function PlanGate({ title, description, tier, features, preview }: PlanGateProps) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "40px 24px",
        textAlign: "center",
        margin: "12px 0",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--color-muted)", marginBottom: 8, textTransform: "uppercase" }}>
        {tierLabel[tier]}
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", color: "var(--color-ink)" }}>{title}</h3>
      <p style={{ color: "var(--color-muted)", fontSize: 14, lineHeight: 1.5, maxWidth: 460, margin: "0 auto 16px" }}>{description}</p>
      {features && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 auto 20px", maxWidth: 360, textAlign: "left", fontSize: 13, color: "var(--color-ink)", lineHeight: 1.8 }}>
          {features.map((f) => (
            <li key={f} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: "var(--color-signal)" }}>✓</span> {f}
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div style={{ opacity: 0.45, filter: "blur(0.3px)", pointerEvents: "none", margin: "0 auto 20px", maxWidth: 520 }}>
          {preview}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <Link href="/pricing" style={{ background: "var(--color-ink)", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          {tierCTA[tier]}
        </Link>
        <Link href="/pricing" style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          Compare plans
        </Link>
      </div>
    </div>
  );
}

export function PlanBadge({ tier }: { tier: Tier }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 6px",
        borderRadius: 4,
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        color: "var(--color-muted)",
      }}
    >
      {tier}
    </span>
  );
}

export function LimitState({ title, description, used, limit, tier }: { title: string; description: string; used: number; limit: number; tier: Tier }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 14, padding: "32px 24px", textAlign: "center", margin: "12px 0" }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{title}</h3>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>{description}</p>
      <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 16 }}>
        {used} / {limit} used
      </div>
      <div style={{ height: 6, background: "var(--color-paper)", borderRadius: 3, overflow: "hidden", maxWidth: 320, margin: "0 auto 16px" }}>
        <div style={{ width: `${Math.min(100, (used / limit) * 100)}%`, height: "100%", background: "var(--color-ink)" }} />
      </div>
      <Link href="/pricing" style={{ background: "var(--color-ink)", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
        {tierCTA[tier]}
      </Link>
    </div>
  );
}

export function SetupState({ title, description, actionLabel, actionHref }: { title: string; description: string; actionLabel: string; actionHref: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 14, padding: "32px 24px", textAlign: "center", margin: "12px 0" }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{title}</h3>
      <p style={{ color: "var(--color-muted)", fontSize: 13, lineHeight: 1.5, maxWidth: 380, margin: "0 auto 16px" }}>{description}</p>
      <Link href={actionHref} style={{ background: "var(--color-ink)", color: "#fff", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
        {actionLabel}
      </Link>
    </div>
  );
}
