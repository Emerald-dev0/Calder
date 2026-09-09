"use client";

import * as React from "react";

interface RevealProps {
 children: React.ReactNode;
 className?: string;
 delay?: number;
 as?: "div" | "section" | "li" | "span";
}

/**
 * Scroll-triggered reveal. Respects prefers-reduced-motion via CSS
 * (elements render visible, no transition). No animation library needed.
 */
export function Reveal({ children, className = "", delay = 0, as = "div" }: RevealProps) {
 const ref = React.useRef<HTMLDivElement | null>(null);
 const [visible, setVisible] = React.useState(false);

 React.useEffect(() => {
 const el = ref.current;
 if (!el) return;
 if (typeof IntersectionObserver === "undefined") {
 setVisible(true);
 return;
 }
 const observer = new IntersectionObserver(
 (entries) => {
 for (const entry of entries) {
 if (entry.isIntersecting) {
 setVisible(true);
 observer.disconnect();
 }
 }
 },
 { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
 );
 observer.observe(el);
 return () => observer.disconnect();
 }, []);

 const Tag = as as "div";

 return (
 <Tag
 ref={ref}
 className={`reveal${visible ? "is-visible" : ""} ${className}`}
 style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
 >
 {children}
 </Tag>
 );
}
