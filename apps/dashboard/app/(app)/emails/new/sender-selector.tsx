"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { StatusPill } from "../../../../components/design-system";

export interface SenderOption {
  id: string;
  displayName: string;
  email: string;
  status: string;
  isDefault: boolean;
}

/**
 * Sender identity selector: search, checkmark + name + address + status
 * (never color alone), full keyboard support.
 */
export function SenderSelector({
  senders,
  value,
  onChange,
}: {
  senders: SenderOption[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const usable = senders.filter((s) => s.status === "verified" || s.status === "connected");
  const rest = senders.filter((s) => s.status !== "verified" && s.status !== "connected");
  const q = query.trim().toLowerCase();
  const matches = (s: SenderOption) =>
    !q || s.displayName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
  const ordered = [...usable.filter(matches), ...rest.filter(matches)];
  const selected = senders.find((s) => s.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
    searchRef.current?.focus();
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && ordered[highlight]) {
      e.preventDefault();
      choose(ordered[highlight].id);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }} onKeyDown={onKey}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose sender"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "var(--radius-md)",
          padding: "9px 12px",
          fontSize: 13.5,
          color: "var(--color-ink)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {selected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <b style={{ display: "block", fontSize: 13.5 }}>{selected.displayName}</b>
              <span
                className="mono"
                style={{ display: "block", fontSize: 11.5, color: "var(--color-muted)" }}
              >
                {selected.email}
              </span>
            </span>
            <StatusPill status={selected.status} />
          </div>
        ) : (
          <span style={{ color: "var(--color-muted)" }}>
            Choose a verified sender identity…
          </span>
        )}
        <ChevronDown size={15} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Senders"
          className="sender-pop"
          style={{
            position: "absolute",
            zIndex: 40,
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            padding: 8,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <div style={{ position: "relative", marginBottom: 6 }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: 10,
                top: 11,
                color: "var(--color-muted)",
              }}
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search senders…"
              aria-label="Search senders"
              className="ds-input"
              style={{ paddingLeft: 30, height: 34 }}
            />
          </div>
          <p
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--color-muted)",
              margin: "4px 6px 6px",
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            YOUR SENDERS
          </p>
          {ordered.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--color-muted)", padding: "8px 6px", margin: 0 }}>
              No senders match.
            </p>
          )}
          {ordered.map((s, i) => {
            const ready = s.status === "verified" || s.status === "connected";
            return (
              <div
                key={s.id}
                role="option"
                aria-selected={value === s.id}
                tabIndex={-1}
                onClick={() => ready && choose(s.id)}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  background:
                    i === highlight ? "var(--color-surface-elevated)" : "transparent",
                  cursor: ready ? "pointer" : "not-allowed",
                  opacity: ready ? 1 : 0.65,
                }}
              >
                <span style={{ width: 16, color: "var(--color-accent)" }} aria-hidden="true">
                  {value === s.id ? <Check size={14} /> : null}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: value === s.id ? 700 : 500,
                    }}
                  >
                    {s.displayName}
                  </span>
                  <span
                    className="mono"
                    style={{ display: "block", fontSize: 11.5, color: "var(--color-muted)" }}
                  >
                    {s.email}
                  </span>
                </span>
                <StatusPill status={s.status} />
              </div>
            );
          })}
          <a
            href="/senders"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              padding: "8px 10px",
              color: "var(--color-ink)",
              borderTop: "1px solid var(--color-border)",
              marginTop: 6,
              textDecoration: "none",
            }}
          >
            <Plus size={13} />
            <span>Add sender identity</span>
          </a>
        </div>
      )}
    </div>
  );
}
