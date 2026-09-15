interface EmptyStateAbstractProps {
  size?: number;
  className?: string;
}

/**
 * Abstract empty-state motif (generated asset, code-cleaned).
 * Gradient IDs prefixed to survive multiple instances per page.
 * Decorative, hidden from assistive tech.
 */
export function EmptyStateAbstract({ size = 120, className = "" }: EmptyStateAbstractProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
    >
      <title>Empty mailbox motif</title>
      <style>{`
 .avesa-halo {
 animation: avesa-breathe 3.5s ease-in-out infinite;
 }
 @keyframes avesa-breathe {
 0%, 100% { opacity: 0.10; }
 50% { opacity: 0.20; }
 }
 @media (prefers-reduced-motion: reduce) {
 .avesa-halo { animation: none; opacity: 0.10; }
 }
 `}</style>
      <defs>
        <radialGradient id="avesaHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3D5AFE" />
          <stop offset="100%" stopColor="#3D5AFE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="avesaTrail" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0B0C0E" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#0B0C0E" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="#F5F4EF" />
      <circle
        className="avesa-halo"
        cx="100"
        cy="100"
        r="72"
        fill="url(#avesaHalo)"
        opacity="0.10"
      />
      <rect
        x="42"
        y="68"
        width="92"
        height="64"
        rx="1"
        fill="none"
        stroke="#0B0C0E"
        strokeWidth="2"
      />
      <path
        d="M43 69 L88 105 L133 69"
        fill="none"
        stroke="#0B0C0E"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M134 132 L145 140 M151 144 L160 150 M166 153 L173 157 M179 160 L184 162"
        fill="none"
        stroke="url(#avesaTrail)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="1 5"
      />
    </svg>
  );
}
