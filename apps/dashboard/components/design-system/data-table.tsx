"use client";

import * as React from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Rows3,
  AlignJustify,
  Copy,
  Check,
  SearchX,
} from "lucide-react";
import { DsButton } from "./primitives";
import { useToast } from "./toast";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  width?: string | number;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => React.ReactNode;
}

export function formatRelativeTime(input: string | Date | null | undefined): {
  relative: string;
  absolute: string;
} {
  if (!input) return { relative: "—", absolute: "Never" };
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return { relative: String(input), absolute: String(input) };
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  const absolute = date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  if (diffSec < 45) return { relative: "just now", absolute };
  if (diffSec < 3600) return { relative: `${Math.floor(diffSec / 60)}m ago`, absolute };
  if (diffSec < 86400) return { relative: `${Math.floor(diffSec / 3600)}h ago`, absolute };
  if (diffSec < 86400 * 30) return { relative: `${Math.floor(diffSec / 86400)}d ago`, absolute };
  return {
    relative: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    absolute,
  };
}

export function RelativeTime({ value }: { value: string | Date | null | undefined }) {
  const { relative, absolute } = formatRelativeTime(value);
  return (
    <time
      suppressHydrationWarning
      dateTime={value ? new Date(value).toISOString() : undefined}
      title={absolute}
      className="tabular-nums"
      style={{
        fontSize: 12.5,
        color: "var(--color-muted)",
        borderBottom: "1px dotted var(--color-border-strong)",
        cursor: "help",
        whiteSpace: "nowrap",
      }}
    >
      {relative}
    </time>
  );
}

export function CopyableMono({
  value,
  truncate = 18,
}: {
  value: string;
  truncate?: number;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const short =
    value.length > truncate ? `${value.slice(0, truncate)}…` : value;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value);
        setCopied(true);
        toast({ title: "Copied ID", description: value, tone: "success" });
        setTimeout(() => setCopied(false), 1400);
      }}
      title={`Click to copy: ${value}`}
      className="mono"
      style={{
        appearance: "none",
        background: "var(--color-surface-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 5,
        padding: "2px 7px",
        fontSize: 11.5,
        color: "var(--color-ink-secondary)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        cursor: "pointer",
      }}
    >
      <span>{short}</span>
      {copied ? <Check size={11} /> : <Copy size={11} style={{ opacity: 0.65 }} />}
    </button>
  );
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowClick,
  toolbarLeft,
  toolbarRight,
  selectable = false,
  bulkActions,
  emptyFilterTitle = "No results for these filters",
  emptyFilterDescription = "Try broadening your search query or clearing active filters.",
  onClearFilters,
  totalLabel,
  footer,
}: {
  data: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  selectable?: boolean;
  bulkActions?: (selectedIds: string[], clear: () => void) => React.ReactNode;
  emptyFilterTitle?: string;
  emptyFilterDescription?: string;
  onClearFilters?: () => void;
  totalLabel?: string;
  footer?: React.ReactNode;
}) {
  const [density, setDensity] = React.useState<"comfortable" | "compact">("comfortable");
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const sortedData = React.useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [data, columns, sortKey, sortDir]);

  const allIds = React.useMemo(() => sortedData.map(getRowId), [sortedData, getRowId]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function handleSort(col: DataTableColumn<T>) {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  }

  return (
    <div className="ds-table-shell">
      <div className="ds-table-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
          {toolbarLeft}
          {selected.size > 0 && bulkActions && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 10px",
                borderRadius: "var(--radius-md)",
                background: "var(--color-accent-muted)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>{selected.size} selected</span>
              {bulkActions(Array.from(selected), () => setSelected(new Set()))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {totalLabel ? (
            <span className="mono tabular-nums" style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
              {totalLabel}
            </span>
          ) : (
            <span className="mono tabular-nums" style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
              {sortedData.length} {sortedData.length === 1 ? "row" : "rows"}
            </span>
          )}
          {toolbarRight}
          <div className="ds-tabs" role="group" aria-label="Table row density">
            <button
              type="button"
              onClick={() => setDensity("comfortable")}
              className={`ds-tab ${density === "comfortable" ? "is-active" : ""}`}
              style={{ padding: "4px 7px" }}
              title="Comfortable rows"
              aria-label="Comfortable row density"
            >
              <Rows3 size={13} />
            </button>
            <button
              type="button"
              onClick={() => setDensity("compact")}
              className={`ds-tab ${density === "compact" ? "is-active" : ""}`}
              style={{ padding: "4px 7px" }}
              title="Compact rows"
              aria-label="Compact row density"
            >
              <AlignJustify size={13} />
            </button>
          </div>
        </div>
      </div>

      {sortedData.length === 0 ? (
        <div style={{ padding: "40px 24px", textAlign: "center" }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-muted)",
              marginBottom: 8,
            }}
          >
            <SearchX size={18} />
          </div>
          <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 14 }}>{emptyFilterTitle}</p>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--color-muted)" }}>
            {emptyFilterDescription}
          </p>
          {onClearFilters && (
            <DsButton variant="secondary" size="sm" onClick={onClearFilters}>
              Clear filters
            </DsButton>
          )}
        </div>
      ) : (
        <div className="ds-table-scroll">
          <table className={`ds-table ${density === "compact" ? "is-compact" : ""}`}>
            <thead>
              <tr>
                {selectable && (
                  <th style={{ width: 38 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all rows"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                  </th>
                )}
                {columns.map((col) => {
                  const isSorted = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      style={{
                        width: col.width,
                        textAlign: col.align ?? "left",
                        cursor: col.sortable ? "pointer" : "default",
                      }}
                      onClick={() => handleSort(col)}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span>{col.header}</span>
                        {col.sortable && (
                          <span style={{ opacity: isSorted ? 1 : 0.45 }}>
                            {!isSorted ? (
                              <ArrowUpDown size={11} />
                            ) : sortDir === "asc" ? (
                              <ArrowUp size={11} />
                            ) : (
                              <ArrowDown size={11} />
                            )}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row) => {
                const id = getRowId(row);
                return (
                  <tr
                    key={id}
                    className={onRowClick ? "is-clickable" : ""}
                    onClick={() => onRowClick?.(row)}
                  >
                    {selectable && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggleOne(id)}
                          aria-label={`Select row ${id}`}
                          style={{ accentColor: "var(--color-accent)" }}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {footer && <div className="ds-card-footer">{footer}</div>}
    </div>
  );
}
