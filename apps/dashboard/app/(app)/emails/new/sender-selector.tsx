"use client";

import { useEffect, useRef, useState } from "react";

export interface SenderOption {
  id: string;
  displayName: string;
  email: string;
  status: string;
  isDefault: boolean;
}

const DOT: Record<string, string> = {
  verified: "#16A34A",
  connected: "#1E3A8A",
  pending: "#B45309",
  disabled: "#737373",
  failed: "#DC2626",
};

function statusText(s: string): string {
  if (s === "verified") return "Verified";
  if (s === "connected") return "Connected";
  if (s === "pending") return "Pending";
  if (s === "disabled") return "Disabled";
  return "Failed";
}

/**
 * Sender identity selector: search, checkmark + name + address + status
 * (never color alone), full keyboard support, sheet on mobile.
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
  }, [open ]);

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
          gap: 10,
          background: "#fff",
          border: "1px solid #D4D4D4",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {selected ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: DOT[selected.status] ?? "#737373",
                flexShrink: 0,
              }}
            />
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", fontSize: 14 }}>{selected.displayName}</b>
              <span className="mono" style={{ display: "block", fontSize: 12, color: "#525252" }}>
                {selected.email}
              </span>
            </span>
          </>
        ) : (
          <span style={{ color: "#737373" }}>Choose a sender…</span>
        )}
        <span aria-hidden="true" style={{ marginLeft: "auto", fontSize: 11, color: "#737373" }}>
          ▾
        </span>
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
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(11,12,14,0.12)",
            padding: 8,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search senders…"
            aria-label="Search senders"
            style={{
              width: "100%",
              height: 36,
              border: "1px solid #E5E5E5",
              borderRadius: 8,
              padding: "0 10px",
              fontSize: 13,
              marginBottom: 6,
              boxSizing: "border-box",
            }}
          />
          <p className="mono" style={{ fontSize: 10, color: "#737373", margin: "4px 4px 6px" }}>
            YOUR SENDERS
          </p>
          {ordered.length === 0 && (
            <p style={{ fontSize: 13, color: "#737373", padding: "8px 4px", margin: 0 }}>
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
                  padding: "9px 10px",
                  borderRadius: 8,
                  background: i === highlight ? "#F5F4EF" : "transparent",
                  cursor: ready ? "pointer" : "not-allowed",
                  opacity: ready ? 1 : 0.65,
                }}
              >
                <span style={{ width: 18, fontWeight: 700, fontSize: 13 }} aria-hidden="true">
                  {value === s.id ? "✓" : ""}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: value === s.id ? 700 : 400 }}>
                    {s.displayName}
                  </span>
                  <span className="mono" style={{ display: "block", fontSize: 12, color: "#525252" }}>
                    {s.email}
                  </span>
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#737373", flexShrink: 0 }}>
                  {statusText(s.status)}
                </span>
              </div>
            );
          })}
          <a
            href="/senders"
            style={{
              display: "block",
              fontSize: 13,
              padding: "9px 10px",
              color: "#0B0C0E",
              borderTop: "1px solid #F0F0F0",
              marginTop: 4,
            }}
          >
            + Add sender
          </a>
        </div>
      )}
    </div>
  );
}
