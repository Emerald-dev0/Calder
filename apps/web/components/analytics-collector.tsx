"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { installCollector, trackPageview } from "../lib/analytics";

/**
 * First-party analytics collector (SRS REQ-082).
 *
 * - Pageviews on every route change (path + referrer + UTM context).
 * - CTA clicks via one delegated listener (installCollector): any anchor
 *   whose destination maps to a known public action, or any element with
 *   an explicit data-cta attribute.
 * - Everything is anonymous ids only; failures are silent.
 */
export default function AnalyticsCollector() {
  const pathname = usePathname();

  useEffect(() => {
    installCollector();
    trackPageview();
  }, [pathname]);

  return null;
}
