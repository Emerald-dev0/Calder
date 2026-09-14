import { Reveal } from "./reveal";

/**
 * Cinematic dark interlude: signals leaving the Calder core and fanning out
 * to recipients, with delivery confirmations returning. Pure SVG + CSS,
 * ownable art direction, no stock, no filler. Respects reduced motion.
 */
export function TransmissionBand() {
  return (
    <section className="transmission" aria-label="Every send emits a lifecycle">
      <svg
        className="transmission-svg"
        viewBox="0 0 1200 480"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* core */}
        <g>
          <rect
            x="560"
            y="200"
            width="80"
            height="80"
            rx="18"
            fill="none"
            stroke="#F5F4EF"
            strokeOpacity="0.85"
            strokeWidth="2.5"
          />
          <path
            d="M578 254 L600 216 L622 254"
            fill="none"
            stroke="#F5F4EF"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M588 244 H608 L612 238 L616 248 L620 242 H624"
            fill="none"
            stroke="#F5F4EF"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="630" cy="244" r="4" fill="#3B82F6" />
        </g>
        {/* outbound arcs, one pulse each, pre-distributed along its path
 via negative delay so they never clump at the core. */}
        {[
          { d: "M640 220 C 800 180, 950 140, 1120 100", x: 1120, y: 100 },
          { d: "M640 240 C 800 240, 950 240, 1120 240", x: 1120, y: 240 },
          { d: "M640 260 C 800 300, 950 340, 1120 380", x: 1120, y: 380 },
          { d: "M560 220 C 400 180, 250 140, 80 100", x: 80, y: 100 },
          { d: "M560 240 C 400 240, 250 240, 80 240", x: 80, y: 240 },
          { d: "M560 260 C 400 300, 250 340, 80 380", x: 80, y: 380 },
        ].map(({ d, x, y }, i) => (
          <g key={d}>
            <path d={d} fill="none" stroke="#F5F4EF" strokeOpacity="0.16" strokeWidth="1.5" />
            <circle
              cx={x}
              cy={y}
              r="3.5"
              fill="#3B82F6"
              className="tx-pulse"
              style={{ offsetPath: `path("${d}")`, animationDelay: `${-i * 1.4}s` }}
            />
          </g>
        ))}
        {/* recipient nodes */}
        {[
          [1120, 100],
          [1120, 240],
          [1120, 380],
          [80, 100],
          [80, 240],
          [80, 380],
        ].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle
              cx={x}
              cy={y}
              r="7"
              fill="none"
              stroke="#F5F4EF"
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
            <circle cx={x} cy={y} r="2.5" fill="#F5F4EF" strokeOpacity="0.8" />
          </g>
        ))}
        {/* orbit rings */}
        <circle
          cx="600"
          cy="240"
          r="120"
          fill="none"
          stroke="#F5F4EF"
          strokeOpacity="0.1"
          strokeWidth="1"
          strokeDasharray="3 9"
        />
        <circle
          cx="600"
          cy="240"
          r="190"
          fill="none"
          stroke="#F5F4EF"
          strokeOpacity="0.07"
          strokeWidth="1"
          strokeDasharray="3 12"
        />
      </svg>
      <div className="wrap transmission-copy">
        <Reveal>
          <p className="eyebrow" style={{ color: "#8FB0FF" }}>
            The signal
          </p>
          <p className="transmission-line">
            Two streams leave this building, <em>and neither one is a mystery.</em>
          </p>
          <p className="transmission-sub mono">
            transactional → immediate · marketing → scheduled · one event log underneath both
          </p>
        </Reveal>
      </div>
    </section>
  );
}
