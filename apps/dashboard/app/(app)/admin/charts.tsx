/**
 * Server-rendered SVG charts — zero dependencies, no hydration cost.
 * All data comes from live queries in the page; empty arrays render
 * honest empty states, never invented curves.
 */

interface Point {
  label: string;
  value: number;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const norm = max / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

export function LineChart({ data, caption }: { data: Point[]; caption: string }) {
  const W = 560;
  const H = 180;
  const PAD = { top: 12, right: 12, bottom: 26, left: 36 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  if (data.every((d) => d.value === 0)) {
    return (
      <figure style={{ margin: 0 }}>
        <div
          style={{
            height: H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#737373",
            fontSize: 13,
            border: "1px dashed #E5E5E5",
            borderRadius: 10,
          }}
        >
          No data in this window yet.
        </div>
        <figcaption className="mono" style={{ fontSize: 11, color: "#737373", marginTop: 6 }}>
          {caption}
        </figcaption>
      </figure>
    );
  }

  const x = (i: number) => PAD.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${(PAD.top + ih).toFixed(1)} L${PAD.left},${(PAD.top + ih).toFixed(1)} Z`;
  const last = data[data.length - 1];

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={caption}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + ih * f}
              y2={PAD.top + ih * f}
              stroke="#E5E5E5"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={PAD.top + ih * f + 4}
              textAnchor="end"
              fontSize={10}
              fill="#737373"
              fontFamily="monospace"
            >
              {Math.round(max * (1 - f))}
            </text>
          </g>
        ))}
        <path d={area} fill="#1E3A8A" opacity={0.08} />
        <path
          d={path}
          fill="none"
          stroke="#0B0C0E"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {last && (
          <>
            <circle
              cx={x(data.length - 1)}
              cy={y(last.value)}
              r={4.5}
              fill="#3D5AFE"
              stroke="#fff"
              strokeWidth={2}
            />
            <text
              x={x(data.length - 1)}
              y={y(last.value) - 10}
              textAnchor="end"
              fontSize={11}
              fontWeight={700}
              fill="#0B0C0E"
            >
              {last.value.toLocaleString()}
            </text>
          </>
        )}
        <text x={PAD.left} y={H - 8} fontSize={10} fill="#737373" fontFamily="monospace">
          {data[0]?.label}
        </text>
        <text
          x={W - PAD.right}
          y={H - 8}
          fontSize={10}
          fill="#737373"
          fontFamily="monospace"
          textAnchor="end"
        >
          {last?.label}
        </text>
      </svg>
      <figcaption className="mono" style={{ fontSize: 11, color: "#737373", marginTop: 6 }}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function BarList({
  data,
  caption,
}: {
  data: (Point & { tone: "ok" | "bad" | "info" })[];
  caption: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const colors = { ok: "#16A34A", bad: "#DC2626", info: "#1E3A8A" } as const;
  return (
    <figure style={{ margin: 0 }}>
      {data.map((d) => (
        <div
          key={d.label}
          style={{
            display: "grid",
            gridTemplateColumns: "130px 1fr 48px",
            gap: 10,
            alignItems: "center",
            padding: "5px 0",
            fontSize: 13,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {d.label}
          </span>
          <div style={{ background: "#F5F4EF", borderRadius: 6, height: 14, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                height: "100%",
                background: colors[d.tone],
                borderRadius: 6,
              }}
            />
          </div>
          <b className="mono" style={{ fontSize: 12, textAlign: "right" }}>
            {d.value.toLocaleString()}
          </b>
        </div>
      ))}
      <figcaption className="mono" style={{ fontSize: 11, color: "#737373", marginTop: 6 }}>
        {caption}
      </figcaption>
    </figure>
  );
}
