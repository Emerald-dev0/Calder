import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

/**
 * Allow legitimate crawlers (search + AI) everywhere public.
 * App, API, auth, and build internals stay out.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/login", "/_next/", "/invite/"],
      },
      {
        // AI/search crawlers required for discovery — same content as humans.
        userAgent: ["OAI-SearchBot", "Bingbot", "Googlebot"],
        allow: "/",
        disallow: ["/api/", "/login", "/invite/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
