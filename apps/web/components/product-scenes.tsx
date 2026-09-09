/**
 * Original spot illustrations in the Calder etching language:
 * ink linework, single blue accent, generous negative space.
 * Transparent backgrounds, they sit on any surface.
 */

export function TemplateScene({ className = "" }: { className?: string }) {
 return (
 <svg
 viewBox="0 0 400 300"
 className={className}
 role="img"
 aria-label="Email template with editable blocks"
 >
 <title>Template blocks</title>
 {/* document */}
 <rect
 x="110"
 y="30"
 width="180"
 height="240"
 rx="6"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="3"
 />
 {/* header image block */}
 <rect
 x="126"
 y="46"
 width="148"
 height="64"
 rx="4"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="2.5"
 />
 <circle cx="200" cy="78" r="12" fill="none" stroke="#0B0C0E" strokeWidth="2.5" />
 <path
 d="M140 102 L170 78 L190 94 L210 72 L260 102"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="2.5"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 {/* text lines */}
 <line
 x1="126"
 y1="132"
 x2="274"
 y2="132"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 <line
 x1="126"
 y1="148"
 x2="274"
 y2="148"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 <line
 x1="126"
 y1="164"
 x2="220"
 y2="164"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 {/* variable chip */}
 <rect x="126" y="182" width="104" height="26" rx="13" fill="#1E3A8A" />
 <circle cx="142" cy="195" r="4" fill="#F5F4EF" />
 <line
 x1="152"
 y1="195"
 x2="214"
 y2="195"
 stroke="#F5F4EF"
 strokeWidth="3"
 strokeLinecap="round"
 />
 {/* button */}
 <rect
 x="126"
 y="222"
 width="148"
 height="32"
 rx="8"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="3"
 />
 <line
 x1="170"
 y1="238"
 x2="230"
 y2="238"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 {/* drifting block handles */}
 <circle cx="96" cy="78" r="5" fill="none" stroke="#0B0C0E" strokeWidth="2.5" />
 <circle cx="96" cy="195" r="5" fill="none" stroke="#0B0C0E" strokeWidth="2.5" />
 <path
 d="M96 83 V190"
 stroke="#0B0C0E"
 strokeWidth="2"
 strokeDasharray="2 6"
 strokeLinecap="round"
 />
 <circle cx="304" cy="120" r="5" fill="#3B82F6" />
 </svg>
 );
}

export function DomainScene({ className = "" }: { className?: string }) {
 return (
 <svg
 viewBox="0 0 400 300"
 className={className}
 role="img"
 aria-label="Verified sending domain shield"
 >
 <title>Domain under protection</title>
 {/* shield */}
 <path
 d="M200 40 L290 72 V150 C 290 210, 250 246, 200 264 C 150 246, 110 210, 110 150 V72 Z"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="3.5"
 strokeLinejoin="round"
 />
 {/* check */}
 <path
 d="M168 152 L193 178 L234 128"
 fill="none"
 stroke="#1E3A8A"
 strokeWidth="9"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 {/* orbiting records */}
 <circle
 cx="200"
 cy="152"
 r="104"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="2"
 strokeDasharray="3 9"
 opacity="0.5"
 />
 <circle cx="200" cy="48" r="7" fill="#F5F4EF" stroke="#0B0C0E" strokeWidth="2.5" />
 <circle cx="296" cy="188" r="7" fill="#3B82F6" />
 <circle cx="104" cy="188" r="7" fill="none" stroke="#0B0C0E" strokeWidth="2.5" />
 {/* TXT chip */}
 <rect
 x="126"
 y="216"
 width="148"
 height="30"
 rx="8"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="2.5"
 strokeDasharray="5 5"
 />
 <line
 x1="142"
 y1="231"
 x2="258"
 y2="231"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 </svg>
 );
}

export function MeterScene({ className = "" }: { className?: string }) {
 return (
 <svg
 viewBox="0 0 400 300"
 className={className}
 role="img"
 aria-label="Usage meter with predictable pricing"
 >
 <title>Metered usage</title>
 {/* gauge */}
 <path
 d="M80 230 A120 120 0 0 1 320 230"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="3.5"
 strokeLinecap="round"
 />
 {/* ticks */}
 {[
 [92, 208],
 [116, 160],
 [152, 122],
 [200, 108],
 [248, 122],
 [284, 160],
 [308, 208],
 ].map(([x, y]) => (
 <line
 key={`${x}-${y}`}
 x1={x}
 y1={y}
 x2={x}
 y2={(y as number) + 14}
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 ))}
 {/* needle */}
 <line
 x1="200"
 y1="230"
 x2="262"
 y2="150"
 stroke="#1E3A8A"
 strokeWidth="7"
 strokeLinecap="round"
 />
 <circle cx="200" cy="230" r="10" fill="#0B0C0E" />
 {/* baseline */}
 <line
 x1="60"
 y1="230"
 x2="340"
 y2="230"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 />
 {/* coins / units */}
 <circle cx="110" cy="262" r="9" fill="none" stroke="#0B0C0E" strokeWidth="2.5" />
 <circle cx="142" cy="262" r="9" fill="none" stroke="#0B0C0E" strokeWidth="2.5" />
 <circle cx="174" cy="262" r="9" fill="#3B82F6" />
 <line
 x1="200"
 y1="262"
 x2="290"
 y2="262"
 stroke="#0B0C0E"
 strokeWidth="3"
 strokeLinecap="round"
 strokeDasharray="2 7"
 />
 </svg>
 );
}
