import type { Metadata } from "next";
import { SmoothScroll } from "../components/smooth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calder — Communication infrastructure that gets out of your way",
  description:
    "Developer-first transactional email infrastructure. OTP, verification, receipts, and notifications through one API — observable from queued to delivered.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Calder — Communication infrastructure that gets out of your way",
    description:
      "Transactional email for modern applications. One API, predictable delivery, every event observable.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
