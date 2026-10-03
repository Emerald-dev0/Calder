"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Mail,
  Send,
  FileCode2,
  UserCheck,
  Globe,
  Inbox,
  Webhook,
  KeyRound,
  Code2,
  Server,
  ScrollText,
  BarChart3,
  ShieldBan,
  Puzzle,
  Gauge,
  History,
  Settings,
  Sun,
  Moon,
  Sparkles,
  CornerDownLeft,
  Palette,
} from "lucide-react";
import { useTheme } from "./theme-provider";
import { Kbd } from "./primitives";

export interface CommandItem {
  id: string;
  group: "Quick Actions" | "Navigate" | "Developer & System" | "Preferences";
  label: string;
  subtitle?: string;
  keywords?: string;
  icon: React.ReactNode;
  shortcut?: string[];
  action: () => void;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const items: CommandItem[] = React.useMemo(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    return [
      {
        id: "act-send-email",
        group: "Quick Actions",
        label: "Compose & Send Test Email",
        subtitle: "Dispatch a transactional message or template preview",
        keywords: "send compose email new test message",
        icon: <Send size={15} />,
        shortcut: ["C"],
        action: go("/emails/new"),
      },
      {
        id: "act-new-template",
        group: "Quick Actions",
        label: "Create Email Template",
        subtitle: "Author a reusable HTML + variable template",
        keywords: "template new create html",
        icon: <FileCode2 size={15} />,
        action: go("/templates/new"),
      },
      {
        id: "act-new-key",
        group: "Quick Actions",
        label: "Issue Scoped API Key",
        subtitle: "Generate an Argon2id-hashed project API key",
        keywords: "api key token secret create",
        icon: <KeyRound size={15} />,
        action: go("/keys"),
      },
      {
        id: "act-verify-domain",
        group: "Quick Actions",
        label: "Add & Verify Sending Domain",
        subtitle: "Configure DKIM, SPF, and DMARC records",
        keywords: "domain dns dkim spf dmarc verify",
        icon: <Globe size={15} />,
        action: go("/domains"),
      },
      {
        id: "nav-overview",
        group: "Navigate",
        label: "Overview",
        subtitle: "Command center, volume metrics, and setup progress",
        keywords: "home dashboard overview stats",
        icon: <LayoutDashboard size={15} />,
        shortcut: ["G", "O"],
        action: go("/"),
      },
      {
        id: "nav-emails",
        group: "Navigate",
        label: "Messages & Logs",
        subtitle: "Unified outbound message explorer & event timeline",
        keywords: "emails messages deliveries logs events",
        icon: <Mail size={15} />,
        shortcut: ["G", "E"],
        action: go("/emails"),
      },
      {
        id: "nav-logs",
        group: "Navigate",
        label: "Delivery Event Stream",
        subtitle: "Real-time provider delivery, bounce, and complaint logs",
        keywords: "logs stream events deliveries",
        icon: <ScrollText size={15} />,
        action: go("/logs"),
      },
      {
        id: "nav-templates",
        group: "Navigate",
        label: "Templates",
        subtitle: "Manage transactional templates and variable schemas",
        keywords: "templates html MJML variables",
        icon: <FileCode2 size={15} />,
        action: go("/templates"),
      },
      {
        id: "nav-domains",
        group: "Navigate",
        label: "Domains & DNS",
        subtitle: "DKIM, SPF, and DMARC verification status",
        keywords: "domains dns dkim spf",
        icon: <Globe size={15} />,
        shortcut: ["G", "D"],
        action: go("/domains"),
      },
      {
        id: "nav-senders",
        group: "Navigate",
        label: "Sender Identities",
        subtitle: "Verified From addresses and reply-to routing",
        keywords: "senders from address identity",
        icon: <UserCheck size={15} />,
        action: go("/senders"),
      },
      {
        id: "nav-suppressions",
        group: "Navigate",
        label: "Suppressions",
        subtitle: "Hard bounces, spam complaints, and manual blocks",
        keywords: "suppressions bounce complaint unsubscribe block",
        icon: <ShieldBan size={15} />,
        action: go("/suppressions"),
      },
      {
        id: "nav-analytics",
        group: "Navigate",
        label: "Deliverability Analytics",
        subtitle: "Volume, bounce rates, and reputation cohorts",
        keywords: "analytics metrics charts pro",
        icon: <BarChart3 size={15} />,
        action: go("/analytics"),
      },
      {
        id: "nav-inbox",
        group: "Navigate",
        label: "Inbound Inbox",
        subtitle: "Receive and route inbound emails to webhooks",
        keywords: "inbox inbound receive pro",
        icon: <Inbox size={15} />,
        action: go("/inbox"),
      },
      {
        id: "dev-keys",
        group: "Developer & System",
        label: "API Keys",
        subtitle: "Manage project API credentials",
        keywords: "keys tokens auth",
        icon: <KeyRound size={15} />,
        shortcut: ["G", "K"],
        action: go("/keys"),
      },
      {
        id: "dev-webhooks",
        group: "Developer & System",
        label: "Webhooks",
        subtitle: "HMAC-signed event endpoints and delivery replay",
        keywords: "webhooks callbacks events",
        icon: <Webhook size={15} />,
        action: go("/webhooks"),
      },
      {
        id: "dev-smtp",
        group: "Developer & System",
        label: "SMTP Relay",
        subtitle: "TLS connection parameters for legacy & SMTP apps",
        keywords: "smtp relay port 587",
        icon: <Server size={15} />,
        action: go("/smtp"),
      },
      {
        id: "dev-sdks",
        group: "Developer & System",
        label: "SDKs & Quickstarts",
        subtitle: "Node.js, Python, Go, Rust, and cURL snippets",
        keywords: "sdks code curl node python go",
        icon: <Code2 size={15} />,
        action: go("/sdks"),
      },
      {
        id: "dev-integrations",
        group: "Developer & System",
        label: "Integrations",
        subtitle: "Connect Slack, Datadog, PostHog, and cloud providers",
        keywords: "integrations slack datadog",
        icon: <Puzzle size={15} />,
        action: go("/integrations"),
      },
      {
        id: "dev-usage",
        group: "Developer & System",
        label: "Usage & Quotas",
        subtitle: "Monthly cycle consumption and rate limits",
        keywords: "usage billing quota plan",
        icon: <Gauge size={15} />,
        action: go("/usage"),
      },
      {
        id: "dev-audit",
        group: "Developer & System",
        label: "Audit Logs",
        subtitle: "Immutable security trail of team and API actions",
        keywords: "audit logs security compliance",
        icon: <History size={15} />,
        action: go("/audit-logs"),
      },
      {
        id: "dev-settings",
        group: "Developer & System",
        label: "Organization & Team Settings",
        subtitle: "Workspace profile, members, sessions, and danger zone",
        keywords: "settings team members sessions org",
        icon: <Settings size={15} />,
        action: go("/settings"),
      },
      {
        id: "dev-design-system",
        group: "Developer & System",
        label: "Living Design System",
        subtitle: "Inspect tokens, typography, and component states",
        keywords: "design system tokens styleguide ui",
        icon: <Palette size={15} />,
        action: go("/dev/design-system"),
      },
      {
        id: "pref-theme",
        group: "Preferences",
        label:
          resolvedTheme === "dark"
            ? "Switch to Light Mode"
            : "Switch to Dark Mode",
        subtitle: "Toggle interface color scheme immediately",
        keywords: "theme dark light mode appearance",
        icon: resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />,
        action: () => {
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          onClose();
        },
      },
    ];
  }, [onClose, router, resolvedTheme, setTheme]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        (item.keywords && item.keywords.toLowerCase().includes(q)),
    );
  }, [items, query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) =>
          filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
        );
      } else if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].action();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, filtered, activeIndex]);

  if (!open) return null;

  const groups: CommandItem["group"][] = [
    "Quick Actions",
    "Navigate",
    "Developer & System",
    "Preferences",
  ];

  let runningIndex = -1;

  return (
    <div
      className="ds-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ds-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{ maxWidth: 600 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <Search size={16} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search pages, domains, keys, settings…"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              color: "var(--color-ink)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div
          style={{
            maxHeight: 380,
            overflowY: "auto",
            padding: "8px",
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--color-muted)",
                fontSize: 13,
              }}
            >
              No matching commands or pages for <b>&ldquo;{query}&rdquo;</b>
            </div>
          ) : (
            groups.map((group) => {
              const groupItems = filtered.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group} style={{ marginBottom: 8 }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--color-muted)",
                      padding: "6px 10px 4px",
                    }}
                  >
                    {group}
                  </div>
                  {groupItems.map((item) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const active = idx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={item.action}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "9px 10px",
                          borderRadius: "var(--radius-md)",
                          border: "none",
                          background: active
                            ? "var(--color-surface-elevated)"
                            : "transparent",
                          color: "var(--color-ink)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 7,
                            background: active
                              ? "var(--color-accent)"
                              : "var(--color-surface-elevated)",
                            color: active
                              ? "var(--color-accent-ink)"
                              : "var(--color-ink-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {item.icon}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--color-ink)",
                            }}
                          >
                            {item.label}
                          </span>
                          {item.subtitle && (
                            <span
                              style={{
                                display: "block",
                                fontSize: 11.5,
                                color: "var(--color-muted)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {item.subtitle}
                            </span>
                          )}
                        </span>
                        {item.shortcut ? (
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            {item.shortcut.map((s) => (
                              <Kbd key={s}>{s}</Kbd>
                            ))}
                          </span>
                        ) : active ? (
                          <CornerDownLeft
                            size={13}
                            style={{ color: "var(--color-muted)" }}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div
          style={{
            padding: "8px 14px",
            borderTop: "1px solid var(--color-border)",
            background: "var(--color-surface-elevated)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11.5,
            color: "var(--color-muted)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={12} style={{ color: "var(--color-accent)" }} />
            <span>Navigate with ↑↓, select with Enter</span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Shortcuts</span>
            <Kbd>?</Kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
