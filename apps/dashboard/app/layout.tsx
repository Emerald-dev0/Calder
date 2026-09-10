import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calder",
  description: "Manage projects, API keys, domains, emails, and webhooks.",
  themeColor: "#F5F4EF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
