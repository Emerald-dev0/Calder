"use client";

import * as React from "react";
import Lenis from "lenis";

/**
 * Lenis smooth scroll (ADR-009). Disabled entirely under
 * prefers-reduced-motion. Anchor links route through lenis.scrollTo.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const lenisRef = React.useRef<Lenis | null>(null);

  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenisRef.current = lenis;

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.('a[href^="#"]');
      if (!anchor) return;
      const id = anchor.getAttribute("href");
      if (!id || id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el as HTMLElement, { offset: -70, duration: 1.4 });
    };
    document.addEventListener("click", onClick);

    // Lightweight parallax: [data-parallax="0.12"] shifts with scroll.
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const vh = window.innerHeight;
        document.querySelectorAll<HTMLElement>("[data-parallax]").forEach((el) => {
          const r = el.getBoundingClientRect();
          const progress = (r.top + r.height / 2 - vh / 2) / vh;
          const speed = Number.parseFloat(el.dataset.parallax ?? "0.1");
          el.style.transform = `translateY(${(-progress * speed * 200).toFixed(1)}px)`;
        });
      });
    };
    lenis.on("scroll", onScroll);
    onScroll();

    return () => {
      document.removeEventListener("click", onClick);
      lenis.off("scroll", onScroll);
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return <>{children}</>;
}
