interface OnboardingPathProps {
 className?: string;
}

/**
 * Journey-to-first-delivery visual (generated asset, code-cleaned).
 * One-shot draw animation kept as-is; plays once on mount.
 * Decorative, hidden from assistive tech.
 */
export function OnboardingPath({ className = "" }: OnboardingPathProps) {
 return (
 <svg
 xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 400 300"
 className={className}
 role="img"
 aria-hidden="true"
 >
 <title>Path from signup to first delivery</title>
 <style>{`
 .avob-journey {
 stroke-dasharray: 1 7;
 stroke-dashoffset: 0;
 animation: avob-draw 2s ease-out forwards;
 }
 .avob-destination {
 transform-box: fill-box;
 transform-origin: center;
 opacity: 0;
 transform: scale(0.8);
 animation: avob-destination-in 0.45s ease-out 2s forwards;
 }
 .avob-checkmark {
 opacity: 0;
 animation: avob-checkmark-in 0.3s ease-out 2.2s forwards;
 }
 @keyframes avob-draw {
 from { stroke-dashoffset: 300; }
 to { stroke-dashoffset: 0; }
 }
 @keyframes avob-destination-in {
 from { opacity: 0; transform: scale(0.8); }
 to { opacity: 1; transform: scale(1); }
 }
 @keyframes avob-checkmark-in {
 from { opacity: 0; }
 to { opacity: 1; }
 }
 @media (prefers-reduced-motion: reduce) {
 .avob-journey { animation: none; stroke-dashoffset: 0; }
 .avob-destination { animation: none; opacity: 1; transform: scale(1); }
 .avob-checkmark { animation: none; opacity: 1; }
 }
 `}</style>
 <rect width="400" height="300" fill="#F5F4EF" />
 <path
 className="avob-journey"
 d="M 55 245 C 105 235, 105 180, 165 175 S 235 135, 285 105 S 325 70, 345 55"
 fill="none"
 stroke="#0B0C0E"
 strokeWidth="2"
 strokeLinecap="round"
 />
 <circle cx="55" cy="245" r="7" fill="none" stroke="#0B0C0E" strokeWidth="2" />
 <circle cx="165" cy="175" r="6" fill="none" stroke="#0B0C0E" strokeWidth="2" />
 <circle cx="285" cy="105" r="6" fill="none" stroke="#0B0C0E" strokeWidth="2" />
 <circle className="avob-destination" cx="345" cy="55" r="18" fill="#3D5AFE" />
 <path
 className="avob-checkmark"
 d="M 336 55 L 342 61 L 354 48"
 fill="none"
 stroke="#FFFFFF"
 strokeWidth="3"
 strokeLinecap="round"
 strokeLinejoin="round"
 />
 </svg>
 );
}
