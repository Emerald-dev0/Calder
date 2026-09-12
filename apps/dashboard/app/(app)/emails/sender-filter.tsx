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
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: "#737373", marginRight: 8 }} htmlFor="sender-filter">
        Sender
      </label>
      <select
        id="sender-filter"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          router.push(
            v ? `/emails?project=${projectId}&sender=${v}` : `/emails?project=${projectId}`
          );
        }}
        style={{
          fontSize: 13,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid #E5E5E5",
          background: "#fff",
        }}
      >
        <option value="">All senders</option>
        {senders.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName} · {s.email}
          </option>
        ))}
      </select>
    </div>
  );
}
