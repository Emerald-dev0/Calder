import * as React from "react";
import { cn } from "../utils";

export const CALDER_MARK_VIEWBOX = "0 0 110 80";
export const CALDER_MARK_DOT = { cx: 18, cy: 50, r: 9 };
/** Origin dot + bold signal-A route. Canonical geometry, keep in sync with apps/web logo. */
export const CALDER_MARK_ROUTE =
  "M31 18C34 12 39 9 46 9h7c5 0 8 3 11 9l27 52H72L51 31c-2-4-5-6-9-6h-4c-3 0-5 2-7 6l-5 9-9-9z";

export type CalderTone = "ink" | "paper";
export const CALDER_TONE_FILL: Record<CalderTone, string> = {
  ink: "#0B0C0E",
  paper: "#F5F4EF",
};

export interface CalderMarkProps extends React.SVGAttributes<SVGSVGElement> {
  tone?: CalderTone;
  scale?: number;
}

/** Calder symbol alone. Square contexts (favicon, app icon, compact nav). */
export function CalderMark({ tone = "ink", scale = 1, ...props }: CalderMarkProps) {
  const fill = CALDER_TONE_FILL[tone];
  return (
    <svg
      width={110 * scale}
      height={80 * scale}
      viewBox={CALDER_MARK_VIEWBOX}
      role="img"
      aria-label="Calder"
      {...props}
    >
      <circle cx={CALDER_MARK_DOT.cx} cy={CALDER_MARK_DOT.cy} r={CALDER_MARK_DOT.r} fill={fill} />
      <path d={CALDER_MARK_ROUTE} fill={fill} />
    </svg>
  );
}

export interface CalderLockupProps {
  tone?: CalderTone;
  /** Mark height in px; wordmark scales with it. */
  size?: number;
  className?: string;
}

/**
 * The ONE Calder lockup: mark + wordmark, fixed proportion and spacing.
 * Full lockup wherever space allows; CalderMark alone only for square
 * constraints (favicon, app icon, compact nav).
 */
export function CalderLockup({ tone = "ink", size = 22, className }: CalderLockupProps) {
  const scale = size / 80;
  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: size * 0.32 }}
      aria-label="Calder"
    >
      <CalderMark tone={tone} scale={scale} aria-hidden="true" />
      <span
        aria-hidden="true"
        style={{
          color: CALDER_TONE_FILL[tone],
          fontWeight: 700,
          fontSize: size * 0.82,
          letterSpacing: "-0.01em",
          lineHeight: 1,
        }}
      >
        Calder
      </span>
    </span>
  );
}
