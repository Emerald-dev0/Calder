export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        background: "linear-gradient(90deg, var(--color-paper) 25%, #f3f3f3 50%, var(--color-paper) 75%)",
        backgroundSize: "200% 100%",
        animation: "skeleton 1.2s ease-in-out infinite",
        borderRadius: 8,
        ...style,
      }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, padding: 16 }}>
      <Skeleton style={{ height: 14, width: "40%", marginBottom: 10 }} />
      <Skeleton style={{ height: 22, width: "60%" }} />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", borderBottom: i === rows - 1 ? "none" : "1px solid #f5f5f5" }}>
          <Skeleton style={{ height: 12, flex: 1 }} />
          <Skeleton style={{ height: 12, width: 80 }} />
          <Skeleton style={{ height: 12, width: 60 }} />
        </div>
      ))}
    </div>
  );
}
