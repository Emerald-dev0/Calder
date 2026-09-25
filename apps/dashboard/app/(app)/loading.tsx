import { CardSkeleton, TableSkeleton } from "../../components/skeleton";

export default function Loading() {
  return (
    <div>
      <div
        style={{
          height: 24,
          width: 160,
          background: "var(--color-paper)",
          borderRadius: 8,
          marginBottom: 12,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
