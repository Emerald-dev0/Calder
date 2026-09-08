interface CalderSignalProps {
  size?: number;
  className?: string;
}

/**
 * Decorative connection motif (generated asset, code-cleaned).
 * Baked pulse kept as-is; class names prefixed to avoid collisions.
 * Purely decorative — hidden from assistive tech.
 */
export function CalderSignal({ size = 64, className = "" }: CalderSignalProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
    >
      <title>Calder signal motif</title>
      <style>{`
        .avsig-accent {
          animation: avsig-pulse 2.5s ease-in-out infinite;
        }
        @keyframes avsig-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          .avsig-accent { animation: none; }
        }
      `}</style>
      <g fill="none" stroke="#0B0C0E" strokeWidth="2" strokeLinecap="round">
        <line x1="32" y1="32" x2="15" y2="19" />
        <line x1="32" y1="32" x2="48" y2="15" />
        <line x1="32" y1="32" x2="51" y2="42" />
        <line x1="32" y1="32" x2="20" y2="49" />
        <circle cx="15" cy="19" r="4" />
        <circle cx="48" cy="15" r="4" />
        <circle cx="51" cy="42" r="4" />
        <circle cx="20" cy="49" r="4" />
        <circle cx="32" cy="32" r="3" />
      </g>
      <circle className="avsig-accent" cx="48" cy="15" r="4" fill="#3D5AFE" />
    </svg>
  );
}
