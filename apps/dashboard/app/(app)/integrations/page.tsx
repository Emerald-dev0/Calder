import Link from "next/link";
import { Puzzle, Mail, GitBranch, Cloud, ArrowRight, ShieldCheck } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

export const metadata = { title: "Calder — Integrations" };

export default function IntegrationsPage() {
  const integrations = [
    {
      name: "Gmail Transport",
      category: "Sending On-Ramp",
      status: "active" as const,
      statusLabel: "Available",
      icon: <Mail size={18} />,
      description:
        "Connect a Gmail account via OAuth 2.0 to dispatch prototype and low-volume emails without configuring custom DNS records. Strictly isolated from Google Sign-In.",
      href: "/senders",
      cta: "Connect Gmail",
    },
    {
      name: "GitHub",
      category: "Repository Context",
      status: "queued" as const,
      statusLabel: "Roadmap",
      icon: <GitBranch size={18} />,
      description:
        "Link GitHub repositories to sync transactional templates from version control and preview changes on pull requests.",
      href: null,
      cta: "Coming soon",
    },
    {
      name: "Vercel",
      category: "DNS & Environment Sync",
      status: "queued" as const,
      statusLabel: "Roadmap",
      icon: <Cloud size={18} />,
      description:
        "Automatically inject CALDER_API_KEY into Vercel preview/production environments and configure domain CNAMEs.",
      href: null,
      cta: "Coming soon",
    },
  ];

  return (
    <div>
      <DsPageHeader
        icon={<Puzzle size={18} />}
        title="Integrations"
        badge={<StatusPill status="active" label="Scoped OAuth" />}
        description="Authentication is who you are. Integrations are what your project can do—scopes never mix."
      />

      <div className="ds-grid-3" style={{ marginBottom: 20 }}>
        {integrations.map((item) => (
          <div
            key={item.name}
            className="ds-card"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div className="ds-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: "var(--color-surface-elevated)",
                      border: "1px solid var(--color-border)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-ink)",
                    }}
                  >
                    {item.icon}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                      {item.category}
                    </div>
                  </div>
                </div>
                <StatusPill status={item.status} label={item.statusLabel} />
              </div>

              <div className="ds-card-body">
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--color-ink-secondary)",
                    lineHeight: 1.55,
                  }}
                >
                  {item.description}
                </p>
              </div>
            </div>

            <div className="ds-card-footer" style={{ justifyContent: "space-between" }}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="ds-btn ds-btn-primary ds-btn-sm"
                  style={{ textDecoration: "none" }}
                >
                  <span>{item.cta}</span>
                  <ArrowRight size={13} />
                </Link>
              ) : (
                <span className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  {item.cta}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div
        className="ds-card"
        style={{
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12.5,
          color: "var(--color-muted)",
        }}
      >
        <ShieldCheck size={16} style={{ color: "var(--color-success)", flexShrink: 0 }} />
        <span>
          Google Sign-In authenticates your operator session. Gmail transport connection authorizes outbound sending—they are cryptographically separate and OAuth scopes never mix.
        </span>
      </div>
    </div>
  );
}
