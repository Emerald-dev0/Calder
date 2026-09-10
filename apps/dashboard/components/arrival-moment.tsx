"use client";

import * as React from "react";
import Image from "next/image";

/**
 * First-delivery celebration: the user's own send arriving, letter layer
 * flying in over the arrival scene. Plays once when scrolled into view.
 * Render it only for a genuine first: the caller gates on a real
 * `email.delivered` event plus no prior deliveries for the org.
 */
export function ArrivalMoment({ firstEver = false }: { firstEver?: boolean }) {
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
      <div className="arrival-letter-group" aria-hidden="true">
        <Image
          src="/illustrations/onboarding-arrival-letter.webp"
          alt=""
          width={924}
          height={266}
          sizes="(max-width: 900px) 100vw, 640px"
          className="arrival-letter"
          priority={false}
        />
      </div>
      <span className="arrival-badge mono">
        {firstEver ? "first delivery · email.delivered" : "delivered · email.delivered"}
      </span>
    </div>
  );
}
