import type { Metadata } from "next";

/**
 * Single source of SEO truth. Every public page builds metadata through
 * pageMeta(), title, description, canonical, OG, Twitter. No page hand-rolls
 * tags; no generic descriptions.
 */
export const SITE_URL = "https://calder.click";
export const SITE_NAME = "Calder";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const VERIFICATION: Record<string, string | undefined> = {
  // Paste Search Console / Bing tokens here at claim time. Never commit secrets;
  // these are public verification strings only.
  // google: "",
  // "msvalidate.01": "",
};

interface PageMetaInput {
  title: string;
  description: string;
  /** Path like "/pricing". Canonical is always absolute. */
  path: string;
  /** Override for OG image (absolute URL). Defaults to the site card. */
  image?: string;
  noindex?: boolean;
}

export function pageMeta({ title, description, path, image, noindex }: PageMetaInput): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title: `${title}, ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title}, ${SITE_NAME}`,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: [{ url: image ?? OG_IMAGE, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title}, ${SITE_NAME}`,
      description,
      images: [image ?? OG_IMAGE],
    },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export function orgJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Calder",
    url: SITE_URL,
    description:
      "Developer-first transactional email infrastructure. One API for OTPs, verification, receipts, and notifications, observable from queued to delivered.",
    foundingDate: "2026",
    areaServed: ["NG", "Worldwide"],
    sameAs: [] as string[],
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Calder",
    url: SITE_URL,
  };
}

export function articleJsonLd(input: {
  title: string;
  description: string;
  path: string;
  datePublished: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    author: { "@type": "Organization", name: "Calder", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Calder", url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}${input.path}`,
    datePublished: input.datePublished,
  };
}
