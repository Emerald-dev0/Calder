/**
 * Server-rendered SVG charts for the Control Plane. Dark-surface variants
 * of the dashboard chart language. Zero dependencies, no hydration cost.
 * Empty data renders an honest empty state, never an invented curve.
 */

export interface Point {
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

function shortLabel(label: string): string {
  // "2026-09-14" → "Sep 14"; pass through anything else.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!m) return label;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export function AreaChart({
  data,
  caption,
  height = 190,
  showLastValue = true,
}: {
  data: Point[];
  caption: string;
  height?: number;
  showLastValue?: boolean;
}) {
  const W = 640;
  const H = height;
  const PAD = { top: 14, right: 14, bottom: 26, left: 44 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <figure style={{ margin: 0 }}>
        <div
          style={{
            height: H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#5c6169",
            fontSize: 13,
            border: "1px dashed #1e2126",
            borderRadius: 10,
          }}
        >
          No data in this window yet.
        </div>
        <figcaption className="mono" style={{ fontSize: 11, color: "#5c6169", marginTop: 6 }}>
          {caption}
        </figcaption>
      </figure>
    );
  }

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const x = (i: number) => PAD.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${(PAD.top + ih).toFixed(1)} L${PAD.left},${(PAD.top + ih).toFixed(1)} Z`;
  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last) return null;

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={caption}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + ih * f} y2={PAD.top + ih * f} stroke="#1e2126" strokeWidth={1} />
            <text x={PAD.left - 6} y={PAD.top + ih * f + 4} textAnchor="end" fontSize={10} fill="#5c6169" fontFamily="ui-monospace, monospace">
              {Math.round(max * (1 - f)).toLocaleString()}
            </text>
          </g>
        ))}
        <path d={area} fill="#3d5afe" opacity={0.1} />
        <path d={path} fill="none" stroke="#e9e8e3" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {last ? (
          <>
            <circle cx={x(data.length - 1)} cy={y(last.value)} r={4} fill="#3d5afe" stroke="#0b0c0e" strokeWidth={2} />
            {showLastValue ? (
              <text
                x={Math.min(x(data.length - 1), W - PAD.right - 4)}
                y={Math.max(y(last.value) - 10, PAD.top + 8)}
                textAnchor="end"
                fontSize={11}
                fontWeight={700}
                fill="#e9e8e3"
                fontFamily="ui-monospace, monospace"
              >
                {last.value.toLocaleString()}
              </text>
            ) : null}
          </>
        ) : null}
        <text x={PAD.left} y={H - 8} fontSize={10} fill="#5c6169" fontFamily="ui-monospace, monospace">
          {shortLabel(first.label)}
        </text>
        <text x={W - PAD.right} y={H - 8} fontSize={10} fill="#5c6169" textAnchor="end" fontFamily="ui-monospace, monospace">
          {shortLabel(last.label)}
        </text>
      </svg>
      <figcaption className="mono" style={{ fontSize: 11, color: "#5c6169", marginTop: 6 }}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function BarsChart({
  data,
  caption,
  height = 170,
  tone = "#e9e8e3",
}: {
  data: Point[];
  caption: string;
  height?: number;
  tone?: string;
}) {
  const W = 640;
  const H = height;
  const PAD = { top: 12, right: 12, bottom: 24, left: 40 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <figure style={{ margin: 0 }}>
        <div
          style={{
            height: H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#5c6169",
            fontSize: 13,
            border: "1px dashed #1e2126",
            borderRadius: 10,
          }}
        >
          No data in this window yet.
        </div>
        <figcaption className="mono" style={{ fontSize: 11, color: "#5c6169", marginTop: 6 }}>
          {caption}
        </figcaption>
      </figure>
    );
  }

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const slot = iw / data.length;
  const bw = Math.max(2, Math.min(26, slot * 0.62));
  const first = data[0];
  const last = data[data.length - 1];
  if (!first || !last) return null;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={caption}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + ih * f} y2={PAD.top + ih * f} stroke="#1e2126" strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const bh = (d.value / max) * ih;
          return (
            <rect
              key={d.label + i}
              x={PAD.left + i * slot + (slot - bw) / 2}
              y={PAD.top + ih - bh}
              width={bw}
              height={Math.max(d.value > 0 ? 2 : 0, bh)}
              rx={2}
              fill={tone}
              opacity={0.72}
            />
          );
        })}
        <text x={PAD.left} y={H - 8} fontSize={10} fill="#5c6169" fontFamily="ui-monospace, monospace">
          {shortLabel(first.label)}
        </text>
        <text x={W - PAD.right} y={H - 8} fontSize={10} fill="#5c6169" textAnchor="end" fontFamily="ui-monospace, monospace">
          {shortLabel(last.label)}
        </text>
      </svg>
      <figcaption className="mono" style={{ fontSize: 11, color: "#5c6169", marginTop: 6 }}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function Sparkline({ data, width = 120, height = 30 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const x = (i: number) => (i / (data.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const path = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block" }}>
      <path d={path} fill="none" stroke="#3d5afe" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
