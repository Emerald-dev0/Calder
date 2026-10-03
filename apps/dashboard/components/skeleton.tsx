import React from "react";

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`ds-skeleton ${className ?? ""}`}
      style={{
        borderRadius: 8,
        ...style,
      }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div
      className="ds-card"
      style={{
        padding: 16,
      }}
    >
      <Skeleton style={{ height: 14, width: "40%", marginBottom: 10 }} />
      <Skeleton style={{ height: 22, width: "60%" }} />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="ds-card" style={{ overflow: "hidden" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 12,
            padding: "12px 14px",
            borderBottom: i === rows - 1 ? "none" : "1px solid var(--color-border)",
          }}
        >
          <Skeleton style={{ height: 12, flex: 1 }} />
          <Skeleton style={{ height: 12, width: 80 }} />
          <Skeleton style={{ height: 12, width: 60 }} />
        </div>
      ))}
    </div>
  );
}
