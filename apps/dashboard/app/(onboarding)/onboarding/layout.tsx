import * as React from "react";

export const metadata = {
  title: "Calder — Setup",
  description: "From zero to your first delivered email.",
};

/**
 * Dedicated full-viewport layout for /onboarding.
 * Renders outside the dashboard shell (no sidebar, no workspace nav) on Paper
 * (#F5F4EF) with a restrained Editorial Infrastructure background signal motif.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="onb-root">
      {/* Subtle architectural signal motif — very low contrast, slow ambient motion */}
      <div className="onb-ambient" aria-hidden="true">
        <svg
          className="onb-ambient-svg"
          viewBox="0 0 1440 900"
          fill="none"
           preserveAspectRatio="xMidYMid slice"
        >
          {/* Precision coordinate grid hairlines */}
          <line
            x1="0"
            y1="180"
            x2="1440"
            y2="180"
            stroke="var(--color-ink)"
            strokeOpacity="0.045"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1="720"
            x2="1440"
            y2="720"
            stroke="var(--color-ink)"
            strokeOpacity="0.045"
            strokeWidth="1"
          />
          <line
            x1="240"
            y1="0"
            x2="240"
            y2="900"
            stroke="var(--color-ink)"
            strokeOpacity="0.04"
            strokeWidth="1"
          />
          <line
            x1="1200"
            y1="0"
            x2="1200"
            y2="900"
            stroke="var(--color-ink)"
            strokeOpacity="0.04"
            strokeWidth="1"
          />

          {/* Subtle signal trajectory arc */}
          <path
            className="onb-ambient-arc"
            d="M 120 760 C 420 720, 520 220, 1320 180"
            stroke="var(--color-ink)"
            strokeOpacity="0.065"
            strokeWidth="1.25"
            strokeDasharray="4 8"
          />

          {/* Concentric relay rings — left origin */}
          <g className="onb-ambient-origin">
            <circle
              cx="240"
              cy="720"
              r="48"
              stroke="var(--color-ink)"
              strokeOpacity="0.05"
              strokeWidth="1"
            />
            <circle
              cx="240"
              cy="720"
              r="4"
              fill="var(--color-ink)"
              fillOpacity="0.14"
            />
          </g>

          {/* Concentric relay rings — right destination */}
          <g className="onb-ambient-dest">
            <circle
              cx="1200"
              cy="180"
              r="76"
              stroke="var(--color-ink)"
              strokeOpacity="0.045"
              strokeWidth="1"
            />
            <circle
              cx="1200"
              cy="180"
              r="36"
              stroke="var(--color-ink)"
              strokeOpacity="0.06"
              strokeWidth="1"
            />
            <circle
              cx="1200"
              cy="180"
              r="4.5"
              fill="var(--color-accent)"
              fillOpacity="0.28"
            />
          </g>
        </svg>
      </div>
      {children}
    </div>
  );
}
