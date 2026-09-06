interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  tone?: "ink" | "paper";
}

/** Final Avenor symbol geometry (see docs/BRAND.md). viewBox 0 0 64 64. */
export const SYMBOL_LEGS = "M10 55 L26 9 L42 55";
export const SYMBOL_PULSE = "M17 41 H24 L27 35 L31 45 L34 39 H41";
export const SYMBOL_DOT = { cx: 45.5, cy: 41, r: 4.5 };

export function LogoMark({ tone = "ink", scale = 1 }: { tone?: "ink" | "paper"; scale?: number }) {
  const stroke = tone === "ink" ? "#0B0C0E" : "#F5F4EF";
  const dot = tone === "ink" ? "#1E3A8A" : "#3B82F6";
  return (
    <svg width={64 * scale} height={64 * scale} viewBox="0 0 64 64" role="img" aria-hidden="true">
      <path
        d={SYMBOL_LEGS}
        fill="none"
        stroke={stroke}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={SYMBOL_PULSE}
        fill="none"
        stroke={stroke}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={SYMBOL_DOT.cx} cy={SYMBOL_DOT.cy} r={SYMBOL_DOT.r} fill={dot} />
    </svg>
  );
}

export function Logo({ size = 30, withWordmark = true, tone = "ink" }: LogoProps) {
  const wordColor = tone === "ink" ? "var(--ink)" : "var(--paper)";
  return (
    <span className="logo" aria-label="Avenor">
      <LogoMark tone={tone} scale={size / 44} />
      {withWordmark && (
        <span className="logo-word" style={{ color: wordColor }}>
          Avenor
        </span>
      )}
    </span>
  );
}
