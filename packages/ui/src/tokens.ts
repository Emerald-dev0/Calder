/**
 * Avenor Design Tokens — Editorial Infrastructure
 * Base: Ink/Paper/Surface/Muted + Avenor Blue accent (signal, not wallpaper)
 */

export const colors = {
  ink: "#0B0C0E",
  paper: "#F5F4EF",
  surface: "#FFFFFF",
  muted: "#737373",
  // Avenor Blue — sophisticated cobalt, used sparingly
  avenorBlue: "#1E3A8A",
  avenorBlueLight: "#3B82F6",
  avenorBlueMuted: "#DBEAFE",
  border: "#E5E5E5",
  borderStrong: "#D4D4D4",
  success: "#16A34A",
  warning: "#CA8A04",
  danger: "#DC2626",
} as const;

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
  "3xl": "4rem",
} as const;

export const radius = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  full: "9999px",
} as const;

export const typography = {
  display: {
    fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
    lineHeight: "1.05",
    letterSpacing: "-0.02em",
    fontWeight: 700,
  },
  h1: {
    fontSize: "clamp(2rem, 4vw, 3rem)",
    lineHeight: "1.1",
    letterSpacing: "-0.015em",
    fontWeight: 700,
  },
  h2: { fontSize: "clamp(1.5rem, 3vw, 2rem)", lineHeight: "1.2", fontWeight: 600 },
  h3: { fontSize: "1.25rem", lineHeight: "1.4", fontWeight: 600 },
  body: { fontSize: "1rem", lineHeight: "1.6", fontWeight: 400 },
  small: { fontSize: "0.875rem", lineHeight: "1.5", fontWeight: 400 },
  caption: { fontSize: "0.75rem", lineHeight: "1.4", fontWeight: 500, letterSpacing: "0.02em" },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.8125rem",
    lineHeight: "1.5",
  },
} as const;
