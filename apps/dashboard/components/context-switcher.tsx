"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

export interface ContextMembership {
  organization: { id: string; name: string; slug: string };
  role: string;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    environment: string;
  }>;
}

const ENV_TONE: Record<string, string> = {
  production: "#0B0C0E",
  staging: "#B45309",
  development: "#737373",
};

function EnvBadge({ env, onDark = false }: { env: string; onDark?: boolean }) {
  const tone = onDark ? "#F5F4EF" : (ENV_TONE[env] ?? "#737373");
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: tone,
        border: `1px solid ${tone}66`,
        borderRadius: 999,
        padding: "1px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {env}
    </span>
  );
}

/**
 * Global org/project/environment context. Links preserve the current path
 * and swap ?project=, so context survives navigation. Native links keep
 * keyboard and screen-reader behavior free.
 */
function SwitcherInner({
  memberships,
  compact = false,
}: {
  memberships: ContextMembership[];
  compact?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("project");

  const allProjects = memberships.flatMap((m) =>
    m.projects.map((p) => ({ ...p, orgId: m.organization.id }))
  );
  const current = allProjects.find((p) => p.id === requested) ?? allProjects[0] ?? null;
  const currentOrg =
    memberships.find((m) => m.organization.id === current?.orgId) ?? memberships[0] ?? null;

  const hrefFor = (projectId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", projectId);
    return `${pathname}?${params.toString()}`;
  };

  if (!currentOrg) {
    return (
      <div style={{ marginBottom: compact ? 0 : 16 }}>
        <p style={{ fontSize: 12, color: "#737373", margin: "0 0 8px" }}>No organization yet.</p>
        <Link href="/onboarding" className="dash-link" style={{ fontSize: 13 }}>
          Get set up →
        </Link>
      </div>
    );
  }

  return (
    <div
      className="ctx-switcher"
      style={{
        marginBottom: compact ? 0 : 20,
        padding: compact ? 0 : "12px",
        border: compact ? "none" : "1px solid #E5E5E5",
        borderRadius: compact ? 0 : 12,
        background: compact ? "transparent" : "#fff",
      }}
    >
      <details style={{ marginBottom: 4 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            color: "#737373",
            listStyle: "none",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          aria-label="Switch organization"
        >
          <span className="mono" style={{ fontSize: 10 }}>
            ORG
          </span>
          <b style={{ color: "#0B0C0E", fontSize: 14 }}>{currentOrg.organization.name}</b>
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            ▾
          </span>
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
          {memberships.map((m) => {
            const first = m.projects[0];
            return (
              <Link
                key={m.organization.id}
                href={first ? hrefFor(first.id) : "/settings"}
                style={{
                  fontSize: 13,
                  padding: "6px 8px",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "#0B0C0E",
                  background:
                    m.organization.id === currentOrg.organization.id ? "#F5F4EF" : "transparent",
                  fontWeight: m.organization.id === currentOrg.organization.id ? 700 : 400,
                }}
              >
                {m.organization.name}
                <span style={{ color: "#737373", fontSize: 11 }}> · {m.role}</span>
              </Link>
            );
          })}
          <Link
            href="/settings#workspace"
            style={{ fontSize: 13, padding: "6px 8px", color: "#0B0C0E" }}
          >
            + New organization
          </Link>
        </div>
      </details>

      {currentOrg.projects.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
          {currentOrg.projects.map((p) => (
            <Link
              key={p.id}
              href={hrefFor(p.id)}
              aria-current={current?.id === p.id ? "true" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                padding: "6px 8px",
                borderRadius: 8,
                textDecoration: "none",
                color: "#0B0C0E",
                background: current?.id === p.id ? "#0B0C0E" : "transparent",
                ...(current?.id === p.id ? { color: "#fff" } : {}),
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <EnvBadge env={p.environment} onDark={current?.id === p.id} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#737373", margin: "8px 0 0" }}>
          No projects in this organization yet.
        </p>
      )}
      <Link
        href="/settings#workspace"
        style={{ display: "block", fontSize: 13, padding: "6px 8px", color: "#0B0C0E" }}
      >
        + New project
      </Link>
    </div>
  );
}

export function ContextSwitcher(props: { memberships: ContextMembership[]; compact?: boolean }) {
  return (
    <Suspense fallback={null}>
      <SwitcherInner {...props} />
    </Suspense>
  );
}
