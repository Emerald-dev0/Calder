"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { RANGE_LABEL, type RangeKey } from "@/lib/control/range";

const RANGE_KEYS: RangeKey[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "90d",
  "this_month",
  "last_month",
  "all",
];

/**
 * Founder topbar (REQ-005/090): page title + context, environment indicator,
 * full date-range control (persisted via URL), refresh, founder avatar.
 * Range changes are server-side navigations so every metric recomputes.
 */
export function FounderTopbar({
  title,
  context,
  rangeKey,
  showRange = true,
  customFrom,
  customTo,
  statusLabel = "Production",
  statusTone = "ok",
}: {
  title: string;
  context: string;
  rangeKey?: RangeKey;
  showRange?: boolean;
  customFrom?: string;
  customTo?: string;
  statusLabel?: string;
  statusTone?: "ok" | "warn" | "bad";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function setRange(key: RangeKey) {
    const sp = new URLSearchParams(params.toString());
    sp.delete("from");
    sp.delete("to");
    sp.set("range", key);
    sp.delete("page");
    setOpen(false);
    startTransition(() => router.push(`?${sp.toString()}`, { scroll: false }));
  }

  function applyCustom() {
    if (!from || !to) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("range", "custom");
    sp.set("from", from);
    sp.set("to", to);
    sp.delete("page");
    setOpen(false);
    startTransition(() => router.push(`?${sp.toString()}`, { scroll: false }));
  }

  const dotClass = statusTone === "ok" ? "ok" : statusTone === "warn" ? "warn" : "bad";

  return (
    <div className="cp-topbar">
      <div className="cp-topbar-title">
        <b>{title}</b>
        <span>{context}</span>
      </div>
      <div className="cp-topbar-right">
        <span className="cp-env">
          <span className={`cp-dot ${dotClass}`} aria-hidden />
          {statusLabel}
        </span>
        {showRange && rangeKey ? (
          <div className="cp-range-wrap" ref={popRef}>
            <button
              type="button"
              className="cp-topbar-control"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-haspopup="menu"
            >
              {rangeKey === "custom" && customFrom && customTo
                ? `${customFrom} → ${customTo}`
                : RANGE_LABEL[rangeKey]}{" "}
              ▾
            </button>
            {open ? (
              <div className="cp-range-pop" role="menu">
                {RANGE_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    data-active={rangeKey === k}
                    onClick={() => setRange(k)}
                  >
                    {RANGE_LABEL[k]}
                  </button>
                ))}
                <div className="cp-range-custom">
                  <input
                    type="date"
                    aria-label="From date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                  <input
                    type="date"
                    aria-label="To date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                  <button type="button" className="cp-topbar-control" onClick={applyCustom}>
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="cp-topbar-control"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
        >
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
