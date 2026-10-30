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

/** Public site-verification tokens are optional deployment configuration. */
export const VERIFICATION = {
  google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
    ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
    : undefined,
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
      "Developer-first transactional email infrastructure for applications, including verification codes, receipts, and notifications.",
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
 * renders. Only the free plan is offered while paid checkout is unavailable.
 */
export function pricingJsonLd(plans: Plan[]): Record<string, unknown> {
  // Paid catalogue prices are not purchasable yet; do not publish them as live offers.
  const offers = plans
    .filter((plan) => plan.id === "beginner")
    .flatMap((plan) => {
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

      // A "contact us" plan has no price, and an Offer without a price is
      // invalid structured data: Google reports "Missing field 'price'", and a
      // machine reading the page is told Calder sells something for null. Skip
      // those plans instead of shipping an empty offer.
      if (priced.length === 0) return [];
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
    description: "Transactional email infrastructure for applications.",
    brand: { "@type": "Brand", name: SITE_NAME },
    url: `${SITE_URL}/pricing`,
    offers,
  };
}
