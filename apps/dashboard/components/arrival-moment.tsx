"use client";

import * as React from "react";
import Image from "next/image";

/**
 * First-delivery celebration: static arrival scene with the letter flying in.
 *
 * INTERIM IMPLEMENTATION — the isolated `onboarding-arrival-letter.webp`
 * layer does not exist yet, so the letter below is a hand-drawn SVG stand-in
 * echoing the illustration (blue envelope + motion streaks, same canvas
 * coordinates as the background). When the real layer lands, swap
 * <ArrivalLetterStandIn> for a positioned <Image> — no layout changes needed.
 *
 * PLACEHOLDER TRIGGER — the scaffold dashboard has no live first-delivery
 * event yet, so this plays once when the card scrolls into view. Wire it to
 * the real `email.delivered` first-ever event when onboarding state exists.
 */
export function ArrivalMoment() {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-arrived");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-arrived");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="arrival"
      role="img"
      aria-label="Illustration of a blue letter arriving at a door letterbox"
    >
      <Image
        src="/illustrations/onboarding-arrival.webp"
        alt=""
        width={1536}
        height={1024}
        sizes="(max-width: 900px) 100vw, 640px"
        className="arrival-bg"
        priority={false}
      />
      <svg viewBox="0 0 1536 1024" className="arrival-letter" aria-hidden="true">
        <g className="arrival-letter-group">
          {/* motion streaks */}
          <path
            d="M610 545 C 680 540, 740 545, 815 552"
            fill="none"
            stroke="#0B0C0E"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M625 578 C 690 574, 745 578, 820 585"
            fill="none"
            stroke="#0B0C0E"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M645 610 C 705 606, 755 610, 825 616"
            fill="none"
            stroke="#0B0C0E"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* envelope body */}
          <polygon
            points="835,485 1010,500 1075,615 890,600"
            fill="#3B82F6"
            stroke="#0B0C0E"
            strokeWidth="5"
            strokeLinejoin="round"
          />
          {/* flap */}
          <path
            d="M835 485 L950 560 L1010 500"
            fill="none"
            stroke="#0B0C0E"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M950 560 L1075 615 M950 560 L890 600"
            fill="none"
            stroke="#0B0C0E"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <span className="arrival-badge mono">first delivery · email.delivered</span>
    </div>
  );
}
