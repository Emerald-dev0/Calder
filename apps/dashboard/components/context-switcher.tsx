"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  ChevronsUpDown,
  Plus,
  Building2,
  FolderGit2,
  Check,
  Settings,
  Sparkles,
} from "lucide-react";

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

function EnvBadge({ env }: { env: string }) {
  const isProd = env === "production";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        color: "var(--color-muted)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: isProd ? "var(--color-success)" : "var(--color-warning)",
        }}
      />
      {env === "production" ? "Live" : env === "development" ? "Dev" : env}
    </span>
  );
}

function SwitcherInner({
  memberships,
  compact = false,
  collapsed = false,
}: {
  memberships: ContextMembership[];
  compact?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("project");
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const allProjects = memberships.flatMap((m) =>
    m.projects.map((p) => ({ ...p, orgId: m.organization.id })),
  );
  const current =
    allProjects.find((p) => p.id === requested) ?? allProjects[0] ?? null;
  const currentOrg =
    memberships.find((m) => m.organization.id === current?.orgId) ??
    memberships[0] ??
    null;

  const hrefFor = (projectId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", projectId);
    return `${pathname}?${params.toString()}`;
  };

  if (!currentOrg) {
    if (collapsed) {
      return (
        <Link
          href="/settings#workspace"
          title="Create your organization"
          className="ds-btn ds-btn-primary ds-btn-icon"
          style={{ width: 38, height: 38, textDecoration: "none", margin: "0 auto" }}
        >
          <Plus size={16} />
        </Link>
      );
    }
    return (
      <div
        style={{
          padding: 12,
          borderRadius: "var(--radius-lg)",
          border: "1px dashed var(--color-border-strong)",
          background: "var(--color-surface-elevated)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--color-ink)",
            marginBottom: 4,
          }}
        >
          <Sparkles size={14} style={{ color: "var(--color-accent)" }} />
          <span>No organization yet</span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--color-muted)", margin: "0 0 10px" }}>
          Create a workspace to provision domains and API keys.
        </p>
        <Link
          href="/settings#workspace"
          className="ds-btn ds-btn-primary ds-btn-sm"
          style={{ width: "100%", textDecoration: "none" }}
        >
          <Plus size={13} />
          <span>Create your organization</span>
        </Link>
      </div>
    );
  }

  const orgInitials = currentOrg.organization.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Switch organization or project: ${currentOrg.organization.name}`}
        title={`${currentOrg.organization.name} · ${current?.name ?? "No project"}`}
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {orgInitials || "O"}
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch organization or project"
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: compact ? "6px 10px" : "8px 10px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          cursor: "pointer",
          textAlign: "left",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: "var(--color-ink)",
            color: "var(--color-surface)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {orgInitials || "O"}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--color-ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {currentOrg.organization.name}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--color-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {current?.name ?? "Default project"}
            </span>
          </span>
        </span>
        {current && <EnvBadge env={current.environment} />}
        <ChevronsUpDown size={14} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            minWidth: 240,
            zIndex: 70,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            padding: 6,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-muted)",
              padding: "6px 8px 4px",
            }}
          >
            Organizations
          </div>
          {memberships.map((m) => {
            const first = m.projects[0];
            const active = m.organization.id === currentOrg.organization.id;
            return (
              <Link
                key={m.organization.id}
                href={first ? hrefFor(first.id) : "/settings"}
                onClick={() => setOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 8px",
                  borderRadius: "var(--radius-md)",
                  textDecoration: "none",
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  color: "var(--color-ink)",
                  background: active ? "var(--color-surface-elevated)" : "transparent",
                }}
              >
                <Building2 size={14} style={{ color: "var(--color-muted)" }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.organization.name}
                </span>
                <span className="mono" style={{ fontSize: 10, color: "var(--color-muted)" }}>
                  {m.role}
                </span>
                {active && <Check size={13} style={{ color: "var(--color-accent)" }} />}
              </Link>
            );
          })}

          {currentOrg.projects.length > 0 && (
            <>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-muted)",
                  padding: "10px 8px 4px",
                  borderTop: "1px solid var(--color-border)",
                  marginTop: 4,
                }}
              >
                Projects in {currentOrg.organization.name}
              </div>
              {currentOrg.projects.map((p) => {
                const isCurrent = current?.id === p.id;
                return (
                  <Link
                    key={p.id}
                    href={hrefFor(p.id)}
                    onClick={() => setOpen(false)}
                    aria-current={isCurrent ? "true" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 8px",
                      borderRadius: "var(--radius-md)",
                      textDecoration: "none",
                      fontSize: 12.5,
                      fontWeight: isCurrent ? 600 : 500,
                      color: "var(--color-ink)",
                      background: isCurrent ? "var(--color-surface-elevated)" : "transparent",
                    }}
                  >
                    <FolderGit2 size={14} style={{ color: "var(--color-muted)" }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    <EnvBadge env={p.environment} />
                  </Link>
                );
              })}
            </>
          )}

          <div
            style={{
              borderTop: "1px solid var(--color-border)",
              marginTop: 6,
              paddingTop: 6,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Link
              href="/settings#workspace"
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: "var(--radius-md)",
                textDecoration: "none",
                fontSize: 12,
                color: "var(--color-ink-secondary)",
              }}
            >
              <Plus size={13} />
              <span>Create organization or project</span>
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                borderRadius: "var(--radius-md)",
                textDecoration: "none",
                fontSize: 12,
                color: "var(--color-ink-secondary)",
              }}
            >
              <Settings size={13} />
              <span>Organization settings</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContextSwitcher(props: {
  memberships: ContextMembership[];
  compact?: boolean;
  collapsed?: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <SwitcherInner {...props} />
    </Suspense>
  );
}
