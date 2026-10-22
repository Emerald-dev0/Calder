"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { DsSelect } from "../../../components/design-system";
import { SORTS, SORT_LABELS, type EmailFilters } from "../../../lib/emails/filters";

/**
 * Filter toolbar.
 *
 * Submits as a GET form so the browser builds the query string itself: the
 * resulting URL is exactly what a colleague can open, and back/forward work
 * without any client-side state to get out of sync. The stream tabs above are
 * plain links for the same reason.
 */
export function EmailFilterBar({
  projectId,
  filters,
  senders,
  domains,
  statuses,
  ranges,
}: {
  projectId: string;
  filters: EmailFilters;
  senders: Array<{ id: string; displayName: string; email: string }>;
  domains: string[];
  statuses: string[];
  ranges: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [q, setQ] = React.useState(filters.q);

  React.useEffect(() => {
    setQ(filters.q);
  }, [filters.q]);

  const active =
    filters.status !== "all" ||
    filters.range !== "all" ||
    filters.sender !== "" ||
    filters.domain !== "" ||
    filters.q !== "";

  return (
    <form
      method="get"
      action="/emails"
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "flex-end",
        marginBottom: 16,
      }}
    >
      <input type="hidden" name="project" value={projectId} />
      {filters.stream !== "all" && <input type="hidden" name="stream" value={filters.stream} />}

      <div style={{ flex: "1 1 260px", minWidth: 220 }}>
        <label htmlFor="email-search" className="ds-label">
          Search
        </label>
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            aria-hidden
            style={{ position: "absolute", left: 11, top: 11, color: "var(--color-muted)" }}
          />
          <input
            id="email-search"
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Recipient, subject, message ID…"
            className="ds-input mono"
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      <div style={{ width: 150 }}>
        <label htmlFor="email-status" className="ds-label">
          Status
        </label>
        <DsSelect id="email-status" name="status" defaultValue={filters.status}>
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </DsSelect>
      </div>

      <div style={{ width: 165 }}>
        <label htmlFor="email-range" className="ds-label">
          Date range
        </label>
        <DsSelect id="email-range" name="range" defaultValue={filters.range}>
          {ranges.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </DsSelect>
      </div>

      <div style={{ width: 180 }}>
        <label htmlFor="email-sender" className="ds-label">
          Sender
        </label>
        <DsSelect id="email-sender" name="sender" defaultValue={filters.sender}>
          <option value="">All senders</option>
          {senders.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </DsSelect>
      </div>

      <div style={{ width: 165 }}>
        <label htmlFor="email-domain" className="ds-label">
          Domain
        </label>
        <DsSelect id="email-domain" name="domain" defaultValue={filters.domain}>
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </DsSelect>
      </div>

      <div style={{ width: 150 }}>
        <label htmlFor="email-sort" className="ds-label">
          Sort
        </label>
        <DsSelect id="email-sort" name="sort" defaultValue={filters.sort}>
          {SORTS.map((v) => (
            <option key={v} value={v}>
              {SORT_LABELS[v]}
            </option>
          ))}
        </DsSelect>
      </div>

      <button type="submit" className="ds-btn ds-btn-primary">
        Apply
      </button>

      {active && (
        <button
          type="button"
          className="ds-btn ds-btn-ghost"
          onClick={() => {
            const params = new URLSearchParams({ project: projectId });
            if (filters.stream !== "all") params.set("stream", filters.stream);
            if (filters.sort !== "newest") params.set("sort", filters.sort);
            router.push(`/emails?${params.toString()}`);
          }}
        >
          <X size={13} />
          <span>Clear</span>
        </button>
      )}
    </form>
  );
}
