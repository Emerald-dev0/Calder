"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CheckCheck, Inbox } from "lucide-react";

/**
 * The notification bell.
 *
 * It shows real rows from the `notifications` table and nothing else. The
 * earlier version of this panel claimed "no bounce spikes, webhook failures, or
 * DNS alerts in the last 24 hours" while querying nothing at all — a claim the
 * product could not back, which is worse than an empty state. When there is
 * nothing to show, the panel says so and explains what will appear here.
 *
 * Refresh strategy, given the dashboard is serverless (no sockets):
 *  - fetch on mount, so the badge is right on first paint after hydration;
 *  - fetch when the window regains focus, because that is when someone looks;
 *  - fetch when the route changes, because navigating is reading;
 *  - poll once a minute, slowly, so a message arriving mid-session appears
 *    without the user having to do anything.
 */

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string;
  readAt: string | null;
  createdAt: string;
}

interface Feed {
  count: number;
  items: NotificationItem[];
  inboxUnread: number;
}

const POLL_MS = 60_000;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(then)
  );
}

export function NotificationBell() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [feed, setFeed] = React.useState<Feed | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Feed;
      setFeed(data);
      setFailed(false);
    } catch {
      // A failed poll must not clear a count we already know: a transient
      // network error is not "you have no notifications".
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Navigating is reading: refresh so the count reflects the page just opened.
  React.useEffect(() => {
    void load();
  }, [pathname, load]);

  React.useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  const markAllRead = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setFeed((prev) =>
          prev
            ? {
                ...prev,
                count: 0,
                items: prev.items.map((i) => ({
                  ...i,
                  readAt: i.readAt ?? new Date().toISOString(),
                })),
              }
            : prev
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const markOneRead = async (id: string) => {
    setFeed((prev) =>
      prev
        ? {
            ...prev,
            count: Math.max(
              0,
              prev.count - (prev.items.find((i) => i.id === id && !i.readAt) ? 1 : 0)
            ),
            items: prev.items.map((i) =>
              i.id === id ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i
            ),
          }
        : prev
    );
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // The optimistic update is enough; the next poll reconciles.
    }
  };

  const unread = feed?.count ?? 0;
  const items = feed?.items ?? [];

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title={unread > 0 ? `${unread} unread` : "Notifications"}
        style={{ position: "relative" }}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 14,
              height: 14,
              padding: "0 3px",
              borderRadius: 999,
              background: "var(--color-danger, #d92d20)",
              color: "#fff",
              fontSize: 9.5,
              fontWeight: 700,
              lineHeight: "14px",
              textAlign: "center",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 330,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            padding: 12,
            zIndex: 80,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={busy}
                className="ds-btn ds-btn-ghost ds-btn-sm"
                style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <CheckCheck size={12} />
                Mark all read
              </button>
            ) : (
              <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                {failed ? "Offline" : "All caught up"}
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                borderRadius: "var(--radius-md)",
                background: "var(--color-surface-elevated)",
                fontSize: 12,
                color: "var(--color-muted)",
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              <Inbox size={16} style={{ marginBottom: 6, opacity: 0.7 }} />
              <div>
                {failed
                  ? "Could not load notifications. This panel shows only real data, so it stays empty until the request succeeds."
                  : "Nothing yet. New conversations and replies in shared inboxes you belong to will appear here."}
              </div>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                maxHeight: 320,
                overflowY: "auto",
                display: "grid",
                gap: 2,
              }}
            >
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      setOpen(false);
                      if (!item.readAt) void markOneRead(item.id);
                    }}
                    style={{
                      display: "block",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-md)",
                      textDecoration: "none",
                      color: "inherit",
                      background: item.readAt ? "transparent" : "var(--color-surface-elevated)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: item.readAt ? 500 : 700,
                          color: "var(--color-ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 10.5, color: "var(--color-muted)", flexShrink: 0 }}
                      >
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    {item.body && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--color-ink-secondary)",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.body}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid var(--color-border)",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              fontSize: 11,
            }}
          >
            <Link href="/inbox" style={{ color: "var(--color-accent)" }}>
              Open shared inbox
              {feed && feed.inboxUnread > 0 ? ` (${feed.inboxUnread})` : ""}
            </Link>
            <Link href="/settings/notifications" style={{ color: "var(--color-muted)" }}>
              Email preferences
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
