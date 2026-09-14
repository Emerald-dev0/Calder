import type { Metadata } from "next";
import type { Plan } from "./plans";

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
      "Email infrastructure for applications. One API for transactional mail (OTPs, verification, receipts) and campaigns, sent on separate pipelines so product mail never inherits a campaign's reputation.",
    foundingDate: "2026",
    founder: founderJsonLd(),
    areaServed: ["NG", "Worldwide"],
    sameAs: [] as string[],
  };
}

export function founderJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Daniel Oluwadare",
    jobTitle: "Founder",
    description: "Founder of Calder, email infrastructure for applications.",
    url: SITE_URL,
    worksFor: { "@type": "Organization", name: "Calder", url: SITE_URL },
    knowsAbout: [
      "Transactional Email",
      "Email Marketing",
      "Deliverability",
      "Developer Infrastructure",
    ],
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

/**
 * Structured data for /pricing, built from the same PLANS array the page
 * renders. Naira and dollar figures are separate price points rather than
 * conversions, so each plan emits one Offer per currency. Scale is quoted, so
 * it carries no price and no fake number.
 */
export function pricingJsonLd(plans: Plan[]): Record<string, unknown> {
  const offers = plans.flatMap((plan) => {
    const entries: { currency: string; price: string }[] = [
      { currency: "USD", price: plan.price.USD },
      { currency: "NGN", price: plan.price.NGN },
    ];
    const priced = entries
      .map((entry) => ({ ...entry, price: entry.price.replace(/[^0-9.]/g, "") }))
      .filter((entry) => entry.price.length > 0);

    const base = {
      "@type": "Offer" as const,
      name: `${plan.name} plan`,
      url: `${SITE_URL}/pricing`,
      availability: "https://schema.org/InStock",
      description: `${plan.promise} ${plan.volume}, ${plan.projects} projects, ${plan.domains} sending domains, ${plan.team} team seat(s), ${plan.logs} log retention, ${plan.support.toLowerCase()} support.`,
    };

    if (priced.length === 0) return [{ ...base }];
    return priced.map((entry) => ({
      ...base,
      name: `${plan.name} plan (${entry.currency})`,
      price: entry.price,
      priceCurrency: entry.currency,
    }));
  });

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Calder",
    description:
      "Email infrastructure for applications: transactional mail and campaigns on separate pipelines.",
    brand: { "@type": "Brand", name: SITE_NAME },
    url: `${SITE_URL}/pricing`,
    offers,
  };
}
