import type { Metadata } from "next";
import { SmoothScroll } from "../components/smooth";
import { SITE_URL, OG_IMAGE, orgJsonLd, websiteJsonLd, founderJsonLd } from "../lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Calder, email infrastructure for applications",
  description:
    "Developer-first transactional email infrastructure. OTP, verification, receipts, and notifications through one API, observable from queued to delivered.",
  icons: { icon: "/favicon.svg" },
  alternates: { canonical: SITE_URL },
  authors: [{ name: "Daniel Oluwadare", url: SITE_URL }],
  creator: "Daniel Oluwadare",
  openGraph: {
    title: "Calder, email infrastructure for applications",
    description:
      "Transactional email for modern applications. One API, predictable delivery, every event observable.",
    url: SITE_URL,
    siteName: "Calder",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Calder" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Calder, email infrastructure for applications",
    description:
      "Transactional email for modern applications. One API, predictable delivery, every event observable.",
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([orgJsonLd(), websiteJsonLd(), founderJsonLd()]),
          }}
        />
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
