interface LogoProps {
 size?: number;
 withWordmark?: boolean;
 tone?: "ink" | "paper";
}

/**
 * Canonical Calder symbol (see docs/brand-board.png): origin dot + bold
 * signal-A route. Geometry matches public/assets/brand/final/calder-symbol.svg.
 * viewBox 0 0 110 80.
 */
export const SYMBOL_DOT = { cx: 18, cy: 50, r: 9 };
export const SYMBOL_ROUTE =
 "M31 18C34 12 39 9 46 9h7c5 0 8 3 11 9l27 52H72L51 31c-2-4-5-6-9-6h-4c-3 0-5 2-7 6l-5 9-9-9z";

export function LogoMark({ tone = "ink", scale = 1 }: { tone?: "ink" | "paper"; scale?: number }) {
 const fill = tone === "ink" ? "#0B0C0E" : "#F5F4EF";
 return (
 <svg width={110 * scale} height={80 * scale} viewBox="0 0 110 80" role="img" aria-hidden="true">
 <title>Calder mark</title>
 <circle cx={SYMBOL_DOT.cx} cy={SYMBOL_DOT.cy} r={SYMBOL_DOT.r} fill={fill} />
 <path d={SYMBOL_ROUTE} fill={fill} />
 </svg>
 );
}

export function Logo({ size = 30, withWordmark = true, tone = "ink" }: LogoProps) {
 const wordColor = tone === "ink" ? "var(--ink)" : "var(--paper)";
 return (
 <span className="logo" aria-label="Calder">
 <LogoMark tone={tone} scale={size / 80} />
 {withWordmark && (
 <span className="logo-word" style={{ color: wordColor }}>
 Calder
 </span>
 )}
 </span>
 );
}
