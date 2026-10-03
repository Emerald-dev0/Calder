"use client";

import { useRouter } from "next/navigation";

/** Sender filter for the deliveries list. Navigates, never fetches. */
export function SenderFilter({
  projectId,
  senders,
  value,
}: {
  projectId: string;
  senders: Array<{ id: string; displayName: string; email: string }>;
  value: string;
}) {
  const router = useRouter();
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <label
        style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)" }}
        htmlFor="sender-filter"
      >
        Sender:
      </label>
      <select
        id="sender-filter"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          router.push(
            v ? `/emails?project=${projectId}&sender=${v}` : `/emails?project=${projectId}`,
          );
        }}
        className="ds-select"
        style={{ height: 32, width: "auto", minWidth: 200, fontSize: 12.5 }}
      >
        <option value="">All sender identities</option>
        {senders.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName} · {s.email}
          </option>
        ))}
      </select>
    </div>
  );
}
